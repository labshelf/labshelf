# Contract: sync

## The folder rule

A library is a folder. The user's sync tool (Dropbox, Google Drive for desktop, OneDrive, iCloud Drive, Nextcloud, Syncthing, rclone or any other) moves it between devices; LabShelf calls no cloud API and keeps no sync state of its own. Every app treats the folder as shared: another device may change any file in it at any time, and the apps pick the change up from the file system.

## What is synced

Everything inside the library folder is synced; files that belong to one device live outside it. Which file is which: [library-format.md#device-local-files](library-format.md#device-local-files).

## Conflict copies

When two devices change the same file before the sync tool reconciles them, the tool keeps both versions. The apps recognise the copies, merge sidecar copies without asking and let the user resolve the others: [library-format.md#conflict-copies](library-format.md#conflict-copies). After each batch of external changes, the apps scan for conflict copies first and reindex after, so a merged sidecar is what the reindex reads.

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
