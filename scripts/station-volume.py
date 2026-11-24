"""macOS filesystem operations for an enrolled player. fd 3 is the pinned volume."""
import ctypes
import errno
import hashlib
import os
import stat
import sys
import uuid

BLOCK = 1024 * 1024
READ = os.O_RDONLY | os.O_NOFOLLOW


def copy(folder, name):
    root = 3
    source = 4
    for component in (folder, name):
        if (component in ("", ".", "..") or component.endswith((".", " "))
                or any(c in '<>:"/\\|?*' or ord(c) < 32 for c in component)
                or component.split(".")[0].upper() in
                    {"CON", "NUL", "PRN", "AUX", *("COM" + str(i) for i in range(1, 10)),
                     *("LPT" + str(i) for i in range(1, 10))}
                or len(component.encode("utf-16-le")) > 510):
            raise ValueError("Filename unsupported by player")
    if not name.lower().endswith(".mp3"):
        raise ValueError("Expected an MP3")
    try:
        os.mkdir(folder, dir_fd=root)
    except FileExistsError:
        pass
    directory = os.open(folder, READ | os.O_DIRECTORY, dir_fd=root)
    tmp = ".mp3-deck-" + uuid.uuid4().hex + ".part"
    created = False
    try:
        if os.fstat(directory).st_dev != os.fstat(root).st_dev:
            raise ValueError("Destination changed")
        before = os.fstat(source)
        if not stat.S_ISREG(before.st_mode) or before.st_size <= 0:
            raise ValueError("Source unavailable")
        # A mismatching file at the intended name may belong to someone else.
        try:
            os.stat(name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ValueError("Destination name already in use")

        digest = hashlib.sha256()
        fd = os.open(tmp, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
        created = True
        with os.fdopen(fd, "w+b") as out:
            while True:
                chunk = os.read(source, BLOCK)
                if not chunk:
                    break
                out.write(chunk)
                digest.update(chunk)
            out.flush()
            os.fsync(out.fileno())
            if out.tell() != before.st_size or os.fstat(source).st_mtime_ns != before.st_mtime_ns:
                raise ValueError("Source changed during transfer")
            out.seek(0)
            saved = hashlib.sha256()
            for chunk in iter(lambda: out.read(BLOCK), b""):
                saved.update(chunk)
            if digest.digest() != saved.digest():
                raise ValueError("Verification failed")
        # renameatx_np(RENAME_EXCL) publishes atomically without replacing an existing file.
        if sys.platform == "darwin":
            libc = ctypes.CDLL(None, use_errno=True)
            if libc.renameatx_np(directory, os.fsencode(tmp), directory, os.fsencode(name), 4):
                code = ctypes.get_errno()
                raise OSError(code, os.strerror(code))
        else:
            # Linux fixture filesystems support exclusive hard-link publication.
            os.link(tmp, name, src_dir_fd=directory, dst_dir_fd=directory)
            os.unlink(tmp, dir_fd=directory)
        created = False
    finally:
        if created:
            os.unlink(tmp, dir_fd=directory)
        os.close(directory)


if __name__ == "__main__":
    try:
        action, first, second = sys.argv[1:]
        if action == "copy":
            copy(first, second)
        else:
            raise ValueError("Unknown action")
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(28 if isinstance(exc, OSError) and exc.errno == errno.ENOSPC else 1)
