# Contract: sync

## The folder rule

A library is a folder. The user's sync tool (Dropbox, Google Drive for desktop, OneDrive, iCloud Drive, Nextcloud, Syncthing, rclone or any other) moves it between devices; LabShelf calls no cloud API and keeps no sync state of its own. Every app treats the folder as shared: another device may change any file in it at any time, and the apps pick the change up from the file system.

## What is synced

Everything inside the library folder is synced; files that belong to one device live outside it. Which file is which: [library-format.md#device-local-files](library-format.md#device-local-files).

## Project write records

Project write records travel with the project: [library-format.md#labshelfwrites](library-format.md#labshelfwrites). Each device writes its own UUID-named file, so devices never compete to update the same record file and the sync tool has no concurrent-device conflict copies to create for these records. A source file and its record may arrive independently. The collaboration mirror waits for in-flight versions under [collaboration.md](collaboration.md#device-local-state).

## Conflict copies

When two devices change the same file before the sync tool reconciles them, the tool keeps both versions. The apps recognise the copies, merge sidecar copies without asking and let the user resolve the others: [library-format.md#conflict-copies](library-format.md#conflict-copies). After each batch of external changes, the apps scan for conflict copies first and reindex after, so a merged sidecar is what the reindex reads.

A writing project's text files (`.tex .typ .bib .md .yaml .json .sty .cls .txt .csv .qmd`, valid UTF-8) have a device-local version store under `<state>/libraries/<key>/merge-bases/` ([library-format.md#device-local-files](library-format.md#device-local-files)). Each file keeps up to 20 distinct version texts indexed by their SHA-256 hash, pinning its last successfully saved or accepted version while evicting the oldest other text, and its common ancestor for named conflict copies. A deleted project file keeps this history. A file's common ancestor is seeded on first sight without conflict copies; after a single-copy merge it holds the other copy's text (an item file keeps its ancestor, see below), and a merge of several copies keeps the common ancestor. Saving a file retains the ancestor. Binary and non-UTF-8 files have no text history.

The conflict scan covers the projects in `projects/` and the registered project folders outside the library. A conflict copy of a project text file that has a base is merged line by line into the file: edits that do not overlap are combined, and overlapping edits are kept in full between `<<<<<<< local`, `=======` and `>>>>>>> <sync tool>` markers. The merged file keeps the local file's line endings. A qmd item file (`.qmd`) merges item by item instead, also without a base: [qmd-items.md#merge](qmd-items.md#merge); this holds for conflict copies and divergent versions alike. Several copies of one file are folded in one after another against the same base. The merged file is written atomically, only if the file did not change during the merge, and read back before the copies are deleted. A copy without a base (other than of an item file), of a binary file, or whose merge fails stays on disk for the user's choice (keep mine, keep the other, keep both).

Item files outside projects, a paper's `notes.qmd` and every `.qmd` file in a Space folder, merge the same way, each against its own device-local base in the same store ([library-format.md#device-local-files](library-format.md#device-local-files)). An item file's base, in a project too, is seeded on first sight without conflict copies and never takes a copy's text: a copy may be this device's own version, and an old base only brings deleted items back. Copies outside projects are folded in from the oldest modification time to the newest. A file missing while its copy exists merges as a union by id; a file or copy that is not UTF-8 text stays on disk for the user.

A newly appeared project text file with an unrecognised name is checked against sibling files: a recorded version hash takes precedence, followed by the same extension with at least 60% shared lines relative to the larger text. The most similar sibling wins. Known provider names take precedence over content detection. LabShelf's `(copy N)` files, hidden paths, dependency folders and build output are excluded. Paper folders use the provider name rules only.

A content match asks whether the appeared file is a version of the sibling. **Merge Automatically** selects the stored sibling version most similar to the copy as the three-way base, including the shared project's device-local collaboration versions and agreed base, falling back to the named-copy merge base when no stored version is available. The merge keeps overlapping edits in conflict markers, writes atomically, records the resulting version and removes the copy only after checking both texts. Without a readable base the copy stays on disk. **Merge Myself** opens or prints both paths and leaves the files. **Not a Version** remembers the absolute path and SHA-256 hash in the device-local `conflict-dismissals.json` next to `merge-bases/`; the file is offered again only if its content changes.

Shared projects use the collaboration mirror to hold detected copies out of the shared file index until the user resolves them. Merged text enters through the original file's ordinary reconciliation. A dismissed file can enter the share. The ordinary project merge scan skips shared projects; their prompt scan only reads files.

## Partial writes and noise

A sync tool writes a file in several steps and leaves its own files in the folder. The apps tolerate both:

- Temporary and partial download names of the known sync tools, the tools' own metadata files, and LabShelf's scratch folders (`.research/tmp/`, `.research/staging/`) are not changes to the library and trigger nothing.
- Changes are handled in debounced batches, never file by file.
- A `metadata.yaml` that fails to parse keeps the paper's previous record and is read again on the next batch. A paper is removed only when its folder or its `metadata.yaml` is gone, never because a file is half-written.
- LabShelf's own writes are atomic (a temp file renamed into place), so a sync tool never uploads half a file.

## A missing library folder

The library folder may disappear while an app runs: a drive is unmounted, a sync tool is paused or the folder is moved. The app shows "Library folder not found", changes nothing on disk and watches for the folder to return, then reloads the library. Watching covers `papers/`, `.research/` and `projects/`.

## The browser

The browser extension cannot open a folder by itself. It reaches the library through the bridge to a desktop app, which reads and writes the folder under the rules above: [bridge.md](bridge.md).

## Divergent versions

For project text outside a share, VS Code records the on-disk parent before an editor save and records the final text after save participants run. LabShelf project writes append an `app` write record before the atomic file write. Prepared text is retained without advancing the last successful version; failed writes leave that version intact. The collaboration mirror owns shared projects.

During an external change batch, a disk version whose recorded parent differs from this device's last successful version is merged when both parent and local texts are retained. The recorded parent is the base, this device's version is local, and the disk text is the other version. A clean merge is written atomically, stored and recorded; VS Code shows an information notice. Overlapping edits preserve both complete versions for Keep mine, Keep the other or Keep both. App-created divergence copies use `<original>.labshelf-conflict-<UUID>`; every device recognises these copies as requiring a choice and leaves them out of automatic copy merges. The pending conflict survives a restart and repeated scans keep offering it until resolved. Files without a matching write record keep their last successful local version available for a record that arrives later. A matching parent or unavailable ancestor follows the ordinary file-change path.
