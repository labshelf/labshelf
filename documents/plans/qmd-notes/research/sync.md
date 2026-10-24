sha: 0069f02
files: documents/contracts/{sync,library-format,spaces}.md, packages/core/src/writing/merge/**, packages/core/src/library/conflicts/**, packages/core/src/library/node/atomicWrite.ts, packages/{vscode,terminal}/src/activation/**, packages/terminal/src/app/context.ts
source: Explore scout

# Sync and conflict copies

## Contract
- sync.md:15-21: project text files (.tex .typ .bib .md .yaml .json .sty .cls .txt .csv, UTF-8) merge 3-way vs a device-local base; no base/binary/failed merge: copy stays for the user. Merged file written atomically only if unchanged meanwhile, read back, then copies deleted.
- Base written only when a file is first seen without one, and after merging ONE copy (copy text becomes base). Never on save. Store never deletes.
- library-format.md:42 bases: <state dir>/libraries/<key>/merge-bases/<project id>/<path>.
- library-format.md:314-331: names of Syncthing, Nextcloud, Dropbox, rclone only; folders and hidden files skipped. Sidecar copies auto-merged; other papers/ files: keepMine/keepOther/keepBoth. Spaces (spaces.md:86): space.json, glossary.json, no keepBoth.

## Code (packages/core/src)
- library/conflicts/conflictNames.ts:27 parseConflictName. conflictCopy.ts:9 ConflictCopy {owner paper|project|space, original, copy, tool}.
- writing/merge/node/libraryConflictScan.ts:22 scanLibraryConflicts: serialized per root; papers, projects, spaces.
- library/conflicts/node/conflictScan.ts:31 scanConflictCopies: sidecar merge, then lists copies under <root>/papers/** (list only).
- library/conflicts/node/spaces/spaceConflictScan.ts:23 only space.json/glossary.json directly in spaces/<id>/.
- writing/merge/node/projectConflictScan.ts:67 scanProjectConflicts (projects/ + registered folders, via listProjectsOnDisk); seedBases :42 skips files with copies; hidden names skipped.
- writing/merge/node/projectCopyMerge.ts:48 mergeProjectCopies: base, local, copies folded vs same base (mergeAll :31), recheck, writeFileAtomic, read back :66, rm copies, base=copy if 1 copy.
- writing/merge/textMerge.ts:27 createTextMerge (diff3, markers); node/mergeText.ts:9; browser binds its own for the collab mirror only (packages/browser/src/library-page/editor/collab/mirror/mergeText.ts).
- writing/merge/mergeableTextFile.ts:3 extension set (.qmd absent); fileMergeBaseStore.ts:18 FileMergeBaseStore, mergeBaseStore.ts IMergeBaseStore {read,write(projectId,relPath)}: project-keyed.

## Sidecar merge
- library/conflicts/sidecarMerge.ts:25 mergeSidecars: union annotations by id, newer mtime wins; no base.
- library/conflicts/node/sidecarConflictMerge.ts:114 mergeSidecarConflicts scans .research/papers/<id>/ for data.json copies only (:124); mergePaper :84 oldest first, stat check, 3 attempts, atomic write, read back.

## Apps
- core library/externalChange/changeBatch.ts:17: scan, onConflicts, reindex.
- vscode: activation/node/nodeAdapters.ts:33 builds store and scan; libraryLifecycle/externalChangeHandling.ts:61 (start), :83 (each batch); library/conflicts/conflictHandling.ts + conflictWalk.ts notify and walk choices.
- terminal: app/context.ts:93-127; app/conflictFeed.ts; ui/app/conflicts/conflictOverlay.ts; cli/setup/conflictsCommand.ts:42.
- browser: no conflict scan or UI found.

## Plug-in points
- Projects: hasMergeableExtension (projectConflictScan.ts:44, mergeableTextFile.ts:6) and mergeText call (projectCopyMerge.ts:34); dispatch by extension there.
- papers/<id>/ files: listed only (conflictScan.ts:12), no base store.
- .research/papers/<id>/: only data.json is merged (sidecarConflictMerge.ts:124).
- Spaces: SPACE_FILES filter (spaceConflictScan.ts:10), list only.
- Join: libraryConflictScan.ts:11-15.

## Atomic write
- library/node/atomicWrite.ts:10 writeFileAtomic(target, content, tmpDir?, mode?): temp, fsync, rename, EXDEV fallback. Read-back is inline at projectCopyMerge.ts:66 and sidecarConflictMerge.ts:96; no shared helper.

## Risks
- Store and ConflictOwner are project-scoped; paper/Space qmd needs another key namespace.
- Base seeded on first sight; a .qmd first seen already diverged has none.
- sync.md:19 extension list must change with code.
