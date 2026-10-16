sha: 252a0ed
files: packages/core/src/{library,library-ui,reader/sidecar,model,ports}/**, documents/contracts/library-format.md, documents/contracts/library-ui-host.md
source: Explore scout, 2026-10-16

# Data behind Last read and file facts

1. **Last read** exists: `reading.updatedAt` in sidecar data.json (reader/sidecar/readingState.ts:13-22), synced (appdata), reaches the list as `PaperStats.lastRead` (library-ui/protocol/payloads.ts:11-16) via `paperStatsOf` (library-ui/derive/sidecarSummary.ts:12). Column exists (dom/list/columnHeads.ts:13, rowCells.ts:52).
2. **Annotations** (model/annotation.ts:20-30): type, pageNumber, content, color, createdAt, updatedAt, in data.json. No latest-highlight function; `PaperStats` carries only a count; full annotations only via `paper.details` for the shown paper. Readable without the PDF in both hosts (VS Code `createSidecarReader`; browser IDB appdata/<id>/data.json — browser reader call not checked).
3. **Note**: `note` string in metadata.yaml (library-format.md:68), on `PaperRecord`, already read for rows. No notes.md.
4. **Files**: no per-paper listing. `paperFiles` (library/layout.ts:92) returns fixed pdf/metadata/bib paths. `ScanFileSystem.listDir` returns names only (ports/localFileSystem.ts:18). `PaperDetails.pdf` has relPath + size. No per-file description anywhere. Contract tree lists only paper.pdf, metadata.yaml, bib.bib. Not checked: whether the scanner/sync carry extra files or subfolders in a paper folder, and whether the browser IDB holds them.
5. **Time**: `relativeTime` (library/format/relativeTime.ts:12) gives "5m ago", "yesterday", "2d ago", "Mar 4". Compact "1 d" missing.
6. **Sort**: `PaperSortKey` (library/model/types.ts:47) and comparators (library/model/paperSort.ts:34) cover Title, Authors, Year, Last read, Status.

## metadata.yaml rules (library-format.md:66-79)
Unknown keys are preserved on rewrite; an app writes only the keys it owns in that action; a metadata refresh does not touch status, tags or note.

## Missing
Compact time formatter; `lastHighlight {page, text}` derived into PaperStats (protocol change, no disk change); note preview from `record.note`; paper-folder file listing (name, kind, size, mtime) over listDir + stat, with a pull message; per-file description storage (user chose a stored field — see plan D-decisions).
