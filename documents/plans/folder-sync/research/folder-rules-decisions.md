sha: 3159f508
files: packages/core/src/library/**, documents/contracts/{sync,library-format}.md
source: decisions taken with the user, 2026-10-17

# Folder rules — decided designs (sessions 2 and 3)

## Device-local state (2.2)
- Per-library key = first 16 hex chars of `sha256Hex(absolute library root)` (`packages/core/src/hash`).
- Cache data (`index.sqlite`, OpenAlex cache, staging) → `<cacheDir()>/libraries/<key>/`.
- State (logs, the external-project registry `projects.json`) → new node helper `stateDir()` = `$XDG_STATE_HOME/labshelf` (default `~/.local/state/labshelf`; macOS `~/Library/Application Support/labshelf`) + `/libraries/<key>/`.
- Layout functions return these paths; callers never build them. The synced part of `.research/` is the per-paper sidecars only.
- No migration of old files (no users).

## Conflict copies (2.3)
- Runtime-neutral `core/src/library/conflicts/`: name parsing per tool → `{original, tool}`; sidecar merge. Node `core/src/library/conflicts/node/`: scan a library, apply a resolution.
- Sidecar (`data.json`) merge, automatic: union of annotations by id; same id in both → the copy from the file with the newer mtime wins; other sidecar fields from the newer file; write atomically, then delete the conflict copy. A deleted annotation may come back; none is lost.
- Other files (`metadata.yaml`, PDFs, attachments): reported as `ConflictCopy {paperId, original, copy, tool}`. Resolutions: `keepMine` (delete the copy), `keepOther` (replace the original with the copy), `keepBoth` (rename the copy to `<name> (copy N).<ext>`; not offered for `metadata.yaml`).
- Nothing is deleted except by a resolution or after a successful sidecar merge. Every merge and resolution is logged through `ILogger`.

## Watchers (2.4)
- Sync tools' temp/partial names join `isExternalChangeNoise`.
- After each debounced batch: run the conflict scan (sidecar merge happens there), then reindex.
- A `metadata.yaml` that fails to parse keeps the paper's previous record and is retried on the next batch (WARN log, never a removal).
- Watch `projects/` too. If the root disappears (unmounted, moved), show "Library folder not found" and re-arm when it returns.

## First run and moving (session 3)
- Default local folder `~/LabShelf` (replaces `~/LabShelfLibrary` in VS Code and the terminal).
- `moveLibrary(from, to)`: same device → rename; otherwise copy the tree, verify file count, sizes and `sha256Hex` of every file, then delete the source; on any failure delete the partial target and keep the source; finally `updateSharedConfig({libraryRoot: to})`. Refuse a target inside the source or a non-empty target that is not a library.
