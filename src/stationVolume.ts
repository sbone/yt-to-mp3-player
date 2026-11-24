import { execFile, spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, rename, stat, statfs, unlink, type FileHandle } from "node:fs/promises";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppDb } from "./db.js";
import { reconcilePendingAgainstDevice } from "./deviceReconcile.js";
import { config } from "./config.js";
import type { DeviceStatus, PendingExportItem } from "./types.js";

export const demoVolumeID = "00000000-0000-4000-8000-000000000001";
const diskHelper = fileURLToPath(new URL("../scripts/station-disk.swift", import.meta.url));
const execute = promisify(execFile);
const helper = fileURLToPath(new URL("../scripts/station-volume.py", import.meta.url));
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validID(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && uuid.test(value);
}

async function runHelper(args: string[], fds: number[] = []): Promise<void> {
  await new Promise<void>((done, fail) => {
    const child = spawn("/usr/bin/python3", ["-I", helper, ...args], { stdio: ["ignore", "ignore", "pipe", ...fds] });
    let detail = "";
    child.stderr?.on("data", (chunk: Buffer) => { detail = (detail + chunk.toString()).slice(-500); });
    child.once("error", fail);
    child.once("close", code => {
      if (code === 0) done();
      else fail(new Error(code === 28 ? "NO SPACE" : detail.trim() || "Player operation failed"));
    });
  });
}

export class StationVolume {
  private attachment = "";
  private constructor(readonly path: string, readonly id: string, private readonly root: FileHandle,
                      private readonly isDemo: boolean) {}

  static async attach(device: DeviceStatus, id: string): Promise<StationVolume> {
    const path = device.mountPath;
    if (!device.connected || !path || !validID(id) || await realpath(path) !== join(await realpath(dirname(path)), basename(path))) {
      throw new Error("CONNECT PLAYER");
    }
    if (config.isDemo) {
      if (id !== demoVolumeID || path !== config.demoPlayerDir || (await stat(path)).dev !== (await stat(dirname(path))).dev) {
        throw new Error("Unknown fixture player");
      }
    } else {
      const record = join(homedir(), "Library/Application Support/mp3-deck/players", id.toUpperCase());
      if (dirname(path) !== "/Volumes" || !(await lstat(record)).isFile()) throw new Error("Unknown player");
    }
    const root = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const target = new StationVolume(path, id.toUpperCase(), root, config.isDemo);
    try {
      if (!config.isDemo) {
        const result = await execute("/usr/bin/swift", [diskHelper, "inspect", path, target.id], { timeout: 60_000 });
        target.attachment = result.stdout.trim();
        if (!/^\d+$/.test(target.attachment)) throw new Error("Invalid player attachment");
      }
      await target.check();
      return target;
    } catch (error) {
      await root.close();
      throw error;
    }
  }

  async check(): Promise<void> {
    const [pinned, current] = await Promise.all([this.root.stat(), lstat(this.path)]);
    if (!current.isDirectory() || pinned.dev !== current.dev || pinned.ino !== current.ino) throw new Error("PLAYER REMOVED");
  }

  async source(path: string): Promise<void> {
    const base = await realpath(config.downloadsDir);
    const canonical = await realpath(path);
    const rel = relative(resolve(config.downloadsDir), resolve(path));
    if (canonical !== resolve(base, rel) || !rel || rel === ".." || rel.startsWith("../") || !(await lstat(path)).isFile()) {
      throw new Error("Invalid local audio file");
    }
  }

  async preflight(items: PendingExportItem[]): Promise<void> {
    await this.check();
    let needed = 0n;
    const space = await statfs(this.path, { bigint: true });
    for (const item of items) {
      await this.source(item.local_path);
      const bytes = (await stat(item.local_path, { bigint: true })).size;
      if (bytes <= 0n) throw new Error("Missing source audio");
      needed += ((bytes + space.bsize - 1n) / space.bsize) * space.bsize;
    }
    if (needed > space.bavail * space.bsize) throw new Error("NO SPACE");
  }

  async copy(item: PendingExportItem): Promise<void> {
    await this.check();
    await this.source(item.local_path);
    const source = await open(item.local_path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await runHelper(["copy", basename(dirname(item.local_path)), basename(item.local_path)], [this.root.fd, source.fd]);
      await this.check();
    } finally { await source.close(); }
  }

  async close(): Promise<void> { await this.root.close(); }

  async eject(): Promise<void> {
    await this.check();
    // A held directory descriptor can prevent a normal OS eject.
    await this.close();
    if (this.isDemo) await rename(this.path, this.path + ".ejected");
    else await execute("/usr/bin/swift", [diskHelper, "eject", this.path, this.id, this.attachment], { timeout: 65_000 });
  }
}

// Reuse the library ledger and filename reconciliation. Delay export marks and cache removal
// until the mounted target has passed verification and the OS has finished ejecting it.
export async function updateStationTracks(db: AppDb, target: StationVolume, refresh: () => Promise<void>,
                                          progress: (copied: number, total: number) => void): Promise<() => Promise<void>> {
  const exported = db.listExportedVideos(-1);
  const recover: number[] = [];
  if (exported.length) {
    const found = await reconcilePendingAgainstDevice(exported, target.path, undefined, undefined, { verifyContents: false });
    const present = new Set(found.exactMatches.map(match => match.item.id));
    recover.push(...exported.filter(item => !present.has(item.id)).map(item => item.id));
  }
  for (const item of db.listPendingExportVideos(-1)) {
    try { await target.source(item.local_path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      recover.push(item.id);
    }
  }
  await target.check();
  db.markVideosForRedownload(recover);
  await refresh();
  await target.check();
  const items = db.listPendingExportVideos(-1);
  const available = new Set(items.map(item => item.id));
  if (recover.some(id => !available.has(id))) throw new Error("CHECK FAILED");
  const cleanup: Array<{ path: string; stamp: BigIntStats }> = [];
  for (const item of items) {
    await target.source(item.local_path);
    cleanup.push({ path: item.local_path, stamp: await stat(item.local_path, { bigint: true }) });
  }
  const found = items.length ? await reconcilePendingAgainstDevice(items, target.path) : null;
  const verified = new Set(found?.exactMatches.map(match => match.item.id));
  const pending = items.filter(item => !verified.has(item.id));
  await target.preflight(pending);
  let copied = 0;
  progress(copied, pending.length);
  for (const item of pending) {
    await target.copy(item);
    progress(++copied, pending.length);
  }
  return async () => {
    db.markVideosAsExported(items.map(item => item.id), "verified station export and confirmed eject");
    for (const { path, stamp } of cleanup) {
      try {
        await target.source(path);
        const now = await lstat(path, { bigint: true });
        if (now.dev === stamp.dev && now.ino === stamp.ino && now.mtimeNs === stamp.mtimeNs && now.size === stamp.size) {
          await unlink(path);
        }
      } catch { /* Cache cleanup is best effort after the durable export mark. */ }
    }
  };
}
