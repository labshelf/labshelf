sha: 1906cb00
files: none
source: help.dropbox.com/files-folders/share/conflicted-copy, docs.syncthing.net/users/syncing.html, github.com/syncthing/syncthing, github.com/nextcloud/desktop, docs.nextcloud.com/server/stable/user_manual/en/desktop/conflicts.html, rclone.org/bisync, rclone.org/docs

# Sync tool conflict copies and noise files
[F] = forum or third-party source. Marker = conflict tag.

## Dropbox
- Conflict: `Report (Alice's conflicted copy 2024-03-01).docx`, marker before the extension. Official page only says user, "conflicted copy" and date are added (help.dropbox.com/files-folders/share/conflicted-copy). Example with extension [F]: github.com/tjluoma/km-diff-dropbox-duplicates.
- Directories: yes, `Alice (Alice's conflicted copy 2026-04-27) (shared folder conflict)` [F] teamdynamix.umich.edu/TDClient/30/Portal/KB/ArticleDet?ID=11835. Case clashes append `(Case Conflict)` (help.dropbox.com/installs-integrations/sync-uploads/case-conflict).
- Noise: hidden `.dropbox.cache/` (temp transfers; cleared every 3 days; help.dropbox.com/en-us/delete-restore/cache-folder); `.dropbox-dist-tmp-*` on Linux [F]. Per-file partial names, `.dropbox`, `.dropbox.attr`: not found (help, forum).

## Google Drive for desktop
- Conflict pattern, directories: not found (help, forum). Reported only: `test (1).txt` duplicate [F] forum.odrive.com/t/duplicate-folders-files-in-google-drive/2946.
- Noise: `.tmp.driveupload`, `.tmp.drivedownload` [F] dropboxforum.com/discussions/101001013/tmp-drivedownload-error---unable-to-resolve-with-tech-support-escalation/286138.

## OneDrive
- Conflict: `MyFile-ComputerName.txt`, name before the extension [F] sharepointmaven.com/how-onedrive-sync-resolves-sync-conflicts/. Numbering and directories: not found (Microsoft article 404).
- Noise: `~$name.docx`, `desktop.ini`, `*.tmp` [F] blog.admindroid.com/onedrive-file-level-exclusion-policies/. Official list: not found.

## iCloud Drive
- Conflict: `name 2.txt` [F] digitechbytes.com/troubleshooting-optimization/fix-icloud-drive-conflicts/; uncertain. Apple documents NSFileVersion for app documents, not copies. Directories: not found.
- Placeholder: evicted `name.ext` becomes hidden `.name.ext.icloud` [F] mjtsai.com/blog/wp-json/wp/v2/posts/21443. Apple docs: not found.

## Nextcloud desktop client
- Conflict: `mydata (conflicted copy 2018-04-10 093612).txt`; with a user name `mydata (conflicted copy alice 2018-04-10 093612).txt`. Marker goes before the last `.` (end of name if none); format `yyyy-MM-dd hhmmss`. Source: docs.nextcloud.com conflicts page; src/common/utility.cpp `makeConflictFileName`. Directories: not found.
- Temp download: hidden `.<name>.~<hex>` in the target directory, e.g. `.paper.json.~1a2b3c4d` (src/libsync/propagatedownload.cpp `createDownloadTmpFileName`).
- Noise: `.sync_<12 hex>.db` (+ `-shm`, `-wal`), old `.csync_journal.db` (src/common/syncjournaldb.cpp), `.sync-exclude.lst`. Default excludes (sync-exclude.lst): `.~lock.*`, `~$*`, `~*.tmp`, `*.part`, `*.filepart`, `*.crdownload`, `._*`, `.DS_Store`, `Thumbs.db`.

## Syncthing
- Conflict: `paper.sync-conflict-20240301-123456-ABCDEFG.json`, i.e. `name.sync-conflict-<date>-<time>-<modifiedBy device ID>.<ext>`, before the last extension (lib/model/folder_sendrecv.go `conflictName`; docs.syncthing.net/users/syncing.html). Copies then sync as normal files. Directories never get copies (code comment: "Directories and symlinks aren't checked for conflicts"); a file replaced by a directory is renamed.
- Temp: `.syncthing.<name>.tmp`; Windows `~syncthing~<name>.tmp`; long names `.syncthing.<sha256>.tmp` (syncing.html; lib/fs/tempname.go).
- Noise: `.stfolder/`, `.stignore`, `.stversions/`, not synced (docs.syncthing.net/users/faq.html). Version file naming: not found.

## rclone bisync
- Conflict: `file.txt.conflict1` (path1) and `file.txt.conflict2` (path2), marker after the extension; `--suffix-keep-extension` gives `file.conflict1.jpg`; `--conflict-loser pathname` gives `file.txt.path1` and `.path2` (older versions `..path1`) (rclone.org/bisync).
- Directories: no copies; decisions are per file.
- Temp: `name.XXXXXX.partial` (`--partial-suffix`) unless `--inplace` (rclone.org/docs). Listings and locks live in the cache dir. `RCLONE_TEST` exists only if the user creates it.
