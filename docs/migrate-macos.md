# Move a downloader library from the Air to the Pro

Use the Air as the source of truth. The result is a separate library on the Pro with the Air's source list, downloaded files, pending queue, export history and run history. The Pro's current library (including its Stream Deck Eject test) stays available for rollback. Histories from the two Macs are independent.

## 1. On the Air, make a snapshot

Let any library or player job finish. Stop the Air downloader in its Terminal with Ctrl-C, or stop its service if it starts automatically. Leave it stopped through cutover so the cache and source list stay consistent with SQLite. The player can stay unplugged throughout the migration.

Use the folder the Air server actually ran from. It should contain `channels.txt`, `data/app.db` and `downloads/`. If the Air checkout lacks the new utility, AirDrop just `scripts/migrate-state.py` from the Pro to the Air's Downloads folder. No update to the Air app is necessary. With Python 3.9 or later, run on the Air:

```sh
cd "$HOME/Code/yt-to-mp3-player"
python3 "$HOME/Downloads/migrate-state.py" snapshot "$PWD" "$HOME/Downloads/air-downloader.zip"
shasum -a 256 "$HOME/Downloads/air-downloader.zip"
```

If the Air checkout already has the utility, use `python3 scripts/migrate-state.py` in place of the Downloads copy. The ZIP must be a new file outside the source library. On the Air, allow space for the ZIP and up to two temporary database copies. On the Pro, allow space for both the ZIP and the restored library.

Keep the printed checksum, five table counts and pending-cache diagnostics. The utility uses SQLite's backup API to include committed WAL pages and checks database integrity and foreign keys. It copies the source list byte for byte and includes regular files in the download cache, including metadata sidecars. Missing cached audio for previously exported tracks is expected. A nonzero pending-cache diagnostic describes an existing library issue. Inspect those tracks on the Air before using Update Player.

## 2. On the Pro, restore into a new directory

AirDrop the ZIP to the Pro's Downloads folder or transfer it privately over SSH. It contains your sources, media and history. Compare the Pro's SHA-256 output with the Air's before restoring. If the hashes differ, transfer the ZIP again.

```sh
cd "$HOME/Code/yt-to-mp3-player"
shasum -a 256 "$HOME/Downloads/air-downloader.zip"
python3 scripts/migrate-state.py restore "$HOME/Downloads/air-downloader.zip" "$HOME/Music/MP3-Air-Library"
```

The parent directory must exist and the final library directory must be new. Restore checks each ZIP entry as it reads it, checks SQLite and reports the same counts and cache diagnostics. Compare them with the Air's output. Absolute track paths in the restored database now point into the Pro's new `downloads/`, including paths retained for tracks already on a player. Keep this directory at its final location. To pick a different location, restore the original ZIP there.

The Pro server can keep running against its original library during this step. Its USB player enrollment in `~/Library/Application Support/mp3-deck/players/` remains on the Pro. Demo data, diagnostic logs, build products, Node packages and machine-specific yt-dlp settings or authentication are outside the snapshot. Older Air installations may have `data/archive.txt`. Keep it with the original checkout for rollback. The current downloader uses SQLite to decide which tracks need downloading.

## 3. Switch the Pro server and verify

In the Pro checkout run `npm run doctor` and `npm run build` using the pinned Node version. If the Air used per-user yt-dlp configuration or credentials, configure the equivalent separately for the Pro's server account. Wait for any Pro job to finish, stop its existing server with Ctrl-C, then start the new build from the project directory:

```sh
cd "$HOME/Code/yt-to-mp3-player"
MP3_STATE_DIR="$HOME/Music/MP3-Air-Library" HOST=127.0.0.1 npm start
```

Use that same state-directory setting for each normal server start. The Deck continues to use loopback port 3000. In the dashboard, check a familiar source, the library and pending counts, and an older completed run before pressing any action key. With the player unplugged, press **Check Sources** once and confirm the run finishes. A source refresh can discover new tracks, so counts can change after this point. When ready to transfer music, plug in the enrolled player, press **Update Player**, and wait for **Safe to Unplug**.

## Roll back

Stop the Pro server when idle. From the same checkout, run `env -u MP3_STATE_DIR HOST=127.0.0.1 npm start` to reopen the original Pro library. The restored directory retains any activity since cutover. The Air can also resume from its original checkout. Choose a single active downloader when resuming, and keep the snapshot and original Air library until you've verified playback on the player.
