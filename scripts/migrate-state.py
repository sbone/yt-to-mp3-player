"""Snapshot an idle downloader or restore its library into a new directory."""
import argparse
import contextlib
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import tempfile
import zipfile


def inspect_db(db):
    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise ValueError("SQLite integrity check failed")
    if db.execute("PRAGMA foreign_key_check").fetchone():
        raise ValueError("SQLite contains a broken reference")
    for table in ("channels", "videos", "sync_runs", "sync_events"):
        print(f"{table}={db.execute('SELECT count(*) FROM ' + table).fetchone()[0]}", end=" ")
    # Libraries predating USB export acquire this table on their first normal startup.
    has_exports = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='device_syncs'").fetchone()
    exports = db.execute("SELECT count(*) FROM device_syncs").fetchone()[0] if has_exports else 0
    print(f"device_syncs={exports}")
    if db.execute("SELECT 1 FROM sync_runs WHERE status='running' LIMIT 1").fetchone():
        raise ValueError("A run is still marked running. Let the source server finish or reconcile it before taking a snapshot.")


def inspect_paths(db, old_root, cache, final_cache=None):
    columns = {row[1] for row in db.execute("PRAGMA table_info(videos)")}
    exported = "exported_at" if "exported_at" in columns else "NULL"
    size = "file_size_bytes" if "file_size_bytes" in columns else "NULL"
    missing = different_size = 0
    rows = db.execute(
        f"SELECT id, local_path, status, {exported}, {size} FROM videos"
    ).fetchall()
    for row_id, path, status, exported_at, expected_size in rows:
        if path is None:
            missing += status == "downloaded" and exported_at is None
            continue
        original = Path(path)
        if not original.is_absolute() or old_root not in original.parents or ".." in original.parts:
            raise ValueError(f"Video {row_id} points outside the source downloads directory. Check its local_path before migrating.")
        target = cache / original.relative_to(old_root)
        if status == "downloaded" and exported_at is None:
            if not target.is_file():
                missing += 1
            elif expected_size is not None and target.stat().st_size != expected_size:
                different_size += 1
        if final_cache is not None:
            final = final_cache / original.relative_to(old_root)
            db.execute("UPDATE videos SET local_path=? WHERE id=?", (str(final), row_id))
    print(f"Pending cache files missing={missing}, size mismatches={different_size}")


def snapshot(source, output):
    cache = source / "downloads"
    db_path = source / "data/app.db"
    channels = source / "channels.txt"
    if not channels.is_file() or not db_path.is_file() or not cache.is_dir():
        raise ValueError("Expected channels.txt, data/app.db and downloads/ in the source library")
    if any(item.is_symlink() for item in (channels, db_path, db_path.parent, cache)):
        raise ValueError("Source state uses a symlink. Inspect its location before migrating.")
    if output.is_relative_to(source):
        raise ValueError("Choose a snapshot location outside the source library")
    with tempfile.TemporaryDirectory() as temp:
        backup = Path(temp) / "app.db"
        wal, shm, journal = [Path(str(db_path) + suffix) for suffix in ("-wal", "-shm", "-journal")]
        # macOS SQLite may need writable sidecars to open a *closed* WAL database.
        # Recover those files on a private copy. An idle open WAL supports a read-only backup.
        source_uri = db_path.as_uri() + "?mode=ro"
        if not (wal.is_file() and shm.is_file()) or journal.exists():
            scratch = Path(temp) / "source.db"
            shutil.copyfile(db_path, scratch)
            for sidecar in (wal, journal):
                if sidecar.exists():
                    shutil.copyfile(sidecar, str(scratch) + sidecar.name[len(db_path.name):])
            source_uri = scratch.as_uri() + "?mode=rw"
        with contextlib.closing(sqlite3.connect(source_uri, uri=True)) as live, \
             contextlib.closing(sqlite3.connect(backup)) as db:
            live.backup(db)
            db.execute("PRAGMA journal_mode=DELETE")
            inspect_db(db)
            inspect_paths(db, cache, cache)
        with output.open("xb") as stream:
            try:
                with zipfile.ZipFile(stream, "w", allowZip64=True) as archive:
                    archive.write(backup, "data/app.db")
                    archive.write(channels, "channels.txt")
                    archive.writestr("downloads-root.txt", str(cache))
                    def scan_error(error):
                        raise error

                    for folder, dirs, files in os.walk(cache, onerror=scan_error):
                        if any((Path(folder) / name).is_symlink() for name in dirs):
                            raise ValueError("The download cache contains a directory link")
                        for name in files:
                            entry = Path(folder) / name
                            if entry.is_symlink() or not entry.is_file():
                                raise ValueError("The download cache contains a link or special file")
                            archive.write(entry, entry.relative_to(source))
            except BaseException:
                output.unlink()
                raise
    print("Snapshot complete:", output)


def restore(archive_path, destination):
    # Work in a sibling so a failed restore cannot be selected as the live state.
    if destination.exists() or destination.is_symlink():
        raise ValueError("Destination already exists. Choose a new directory.")
    with tempfile.TemporaryDirectory(dir=destination.parent, prefix=".mp3-restore-") as temp:
        stage = Path(temp) / "library"
        stage.mkdir()
        (stage / "downloads").mkdir()
        with zipfile.ZipFile(archive_path) as archive:
            names = archive.namelist()
            required = {"channels.txt", "data/app.db", "downloads-root.txt"}
            if len(names) != len(set(names)) or not required.issubset(names):
                raise ValueError("Incomplete or duplicate snapshot entries")
            old_root = Path(archive.read("downloads-root.txt").decode())
            if not old_root.is_absolute() or old_root.name != "downloads" or ".." in old_root.parts:
                raise ValueError("Invalid original downloads directory")
            for name in names:
                if name == "downloads-root.txt":
                    continue
                path = PurePosixPath(name)
                if name not in required and (path.parts[:1] != ("downloads",) or len(path.parts) < 2
                                             or ".." in path.parts or str(path) != name):
                    raise ValueError("Unexpected snapshot entry")
                target = stage / path
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(name) as src, target.open("xb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
        with contextlib.closing(sqlite3.connect(stage / "data/app.db")) as db:
            inspect_db(db)
            with db:
                inspect_paths(db, old_root, stage / "downloads", destination / "downloads")
        destination.mkdir(mode=0o700)  # Exclusive reservation before publishing on the same filesystem.
        stage.rename(destination)
    print("Restored library:", destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["snapshot", "restore"])
    parser.add_argument("source", type=Path, help="Air library directory for snapshot, ZIP file for restore")
    parser.add_argument("destination", type=Path, help="new ZIP for snapshot, new library directory for restore")
    args = parser.parse_args()
    os.umask(0o077)
    source = args.source.expanduser().resolve(strict=True)
    dest = args.destination.expanduser()
    destination = dest.parent.resolve(strict=True) / dest.name
    if args.action == "snapshot":
        snapshot(source, destination)
    else:
        restore(source, destination)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, sqlite3.Error, zipfile.BadZipFile) as error:
        sys.exit(str(error))
