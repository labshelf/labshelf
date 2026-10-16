# Session 2 — base store and three-way text merge

- **Goal:** two authors' edits to one text file between syncs end in one file, never in a conflict copy, and overlaps are marked, never dropped.
- **Starts from:** session 1 committed.
- **Ends with:** the base-store port, `mergeText` and `CoauthorActivity` exist and pass core tests. A3: A edits paragraph 1 and B edits paragraph 5 of `main.tex` between syncs; after both sync, both edits are in one file and no conflict copy exists. A4: A and B edit the same line; the file holds conflict markers (VS Code offers Accept Current / Incoming on them).
- **Owns:** `packages/core/src/sync/` (engine, `merge/`, `node/`), `packages/core/__tests__/sync/`, `packages/core/package.json` (only if a diff3 library is added), `documents/contracts/sync.md`, `documents/contracts/library-format.md`

Runs alone: a dependency change in `packages/core/package.json` must not overlap another session. Sessions 3a and 3c build on the seams below.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | `CoauthorActivity` type and optional `SyncResult.coauthors` | task | main thread | core typecheck | [ ] |
| 2.2 | Base store port and Node adapter | contract | implementer (sonnet), tests first → architecture-reviewer | base tests | [ ] |
| 2.3 | Three-way merge in the "both changed" branch | contract | implementer (opus), tests first → architecture-reviewer | A3, A4 in core tests | [ ] |
| 2.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2.1 — Coauthor type

Add to `packages/core/src/sync/engine/syncTypes.ts`: `CoauthorActivity = {projectId: string; name: string; email?: string; modifiedTime: string}` and `SyncResult.coauthors?: CoauthorActivity[]`. Nothing fills it in this session (session 3a does); session 3c reads it. Proof: `pnpm --filter @labshelf/core typecheck`.

## 2.2 — Base store port and Node adapter

- **Goal:** keep the content of each text file at the last agreed sync, so a later run has the base for a three-way merge (D3).
- **Read only:** `documents/contracts/sync.md` 15–64; `documents/contracts/library-format.md` 7–43; `packages/core/src/sync/engine/syncTypes.ts` 1–90; `packages/core/src/sync/engine/pipeline/syncApply.ts` 1–150; `packages/core/src/sync/coordinator/syncRun.ts` 40–90; `packages/core/src/sync/node/nodeLockStore.ts` 1–45 (Node adapter pattern).
- **Decided:**
  - Port in `core/src/sync/engine/state/`: `read(namespace, path): Promise<string | undefined>` and `write(namespace, path, text): Promise<void>`; it never deletes.
  - Node adapter in `core/src/sync/node/` writing `.research/sync/base/<namespace>/<path>`. The browser's IndexedDB adapter belongs to writing-browser-bridge, not here.
  - Text file = known extension (`.tex`, `.typ`, `.bib`, `.md`, `.yaml`, `.json`, `.sty`, `.cls`, `.txt`, `.csv`) and valid UTF-8; a binary file gets no base.
  - The base is written after an upload, a download or a merge agreed in a completed run; a sync never deletes a base entry.
  - Contract lines land in this package: `.research/sync/base/` in library-format.md Layout (never synced), the base store in sync.md#three-way-diff.
- **Done when:** tests first; core tests pin: base written after an agreed sync, read back, kept when the file is deleted, absent for binary and non-UTF-8 files. `pnpm --filter @labshelf/core test -- sync` and typecheck pass; files ≤ 200 lines.
- **Do not touch:** `packages/vscode`, `packages/browser`, `packages/terminal`; the apps' composition roots, except the line in `syncRun.ts` that passes the adapter to the engine.

## 2.3 — Three-way merge

- **Goal:** merge both-changed text files (D3) without ever dropping text.
- **Read only:** `documents/contracts/sync.md` 45–64; `packages/core/src/sync/engine/pipeline/syncDiff.ts` 1–91; `packages/core/src/sync/engine/pipeline/syncApply.ts` 60–150; `packages/core/src/sync/util/conflictName.ts`; the base-store port from 2.2.
- **Decided:**
  - `mergeText({base, local, remote, remoteLabel}): {text: string; conflicted: boolean}` in `core/src/sync/merge/`, runtime-neutral: diff3 over lines (`node-diff3` or an equivalent MIT library, after the dependency ladder in AGENTS.md §3).
  - On "both changed" for a text file with a base: merge, write locally, upload, update the base.
  - Overlapping hunks get `<<<<<<< local` / `=======` / `>>>>>>> <coauthor>` and the path is reported in `conflicts`.
  - No base, or a binary file: the existing keep-both rule. The local file's line endings are kept.
  - The merge rule lands in sync.md#three-way-diff in this package.
- **Done when:** tests first through the sync fakes: A3 (edits in paragraphs 1 and 5 merge, no conflict copy), A4 (same-line edits leave markers), missing base falls back to keep-both, CRLF file stays CRLF. Use real edit histories, not one-liners. Core sync tests and typecheck pass.
- **Do not touch:** `packages/vscode`, `packages/browser`, `packages/terminal`.
