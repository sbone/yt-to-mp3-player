import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function filesMatch(source: string, target: string): Promise<boolean> {
  const sourceSize = (await stat(source)).size;
  const targetSize = (await stat(target)).size;
  return sourceSize > 0 && sourceSize === targetSize && (await digest(source)) === (await digest(target));
}
