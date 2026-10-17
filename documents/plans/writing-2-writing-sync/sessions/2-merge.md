# Session 2 — base store and three-way merge of text conflict copies

- **Goal:** when the user's sync tool leaves a conflict copy of a project text file, the two authors' edits end in one file, the copy is deleted, and overlaps are marked, never dropped.
- **Starts from:** plan `folder-sync` session 2 committed: conflict copies are detected by name per sync tool under `packages/core/src/library/`, device-local state lives in per-device locations keyed by library root, and `documents/contracts/sync.md` is the folder-sync contract; clean tree.
- **Ends with:** the base-store port, its Node adapter and `mergeText` exist and pass core tests, and the conflict-copy handling merges project text files. A3: A edits paragraph 1 and B edits paragraph 5 of `main.tex` while their sync tool is offline; after it syncs and leaves a conflict copy, both edits are in one file and the conflict copy is gone. A4: A and B edit the same line; the file holds conflict markers (VS Code offers Accept Current / Incoming on them).
- **Owns:** `packages/core/src/writing/merge/` (including `node/`), `packages/core/__tests__/writing/merge/`, `packages/core/src/writing/index.ts`, `packages/core/package.json` (only if a diff3 library is added), `documents/contracts/sync.md`; in `packages/core/src/library/`, only the one call from the conflict-copy handling into the merge.

Runs alone: a dependency change in `packages/core/package.json` must not overlap another session.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | Base store port and Node adapter | contract | implementer (sonnet), tests first → architecture-reviewer | base tests | [ ] |
| 2.2 | Three-way merge of text conflict copies | contract | implementer (opus), tests first → architecture-reviewer | A3, A4 in core tests | [ ] |
| 2.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2.1 — Base store port and Node adapter

- **Goal:** keep, per project text file, the content this device last received from outside, so a later conflict copy has the base for a three-way merge.
- **Read only:** `documents/contracts/sync.md` (device-local state and conflict-copy sections); `documents/contracts/library-format.md` (Layout); the device-local location module that plan `folder-sync` session 2 adds under `packages/core/src/library/node/` (its `index.ts` first).
- **Decided:**
  - Port in `core/src/writing/merge/`: `read(projectId, path): Promise<string | undefined>` and `write(projectId, path, text): Promise<void>`; it never deletes.
  - Node adapter in `core/src/writing/merge/node/`, writing under the device-local location keyed by library root, never inside the library or a project folder. The browser's adapter belongs to writing-browser-bridge, not here.
  - Text file = known extension (`.tex`, `.typ`, `.bib`, `.md`, `.yaml`, `.json`, `.sty`, `.cls`, `.txt`, `.csv`) and valid UTF-8; a binary file gets no base.
  - The base is written when a project text file is first seen, when it changes on disk without a save in this app, and after a merge; a deleted file keeps its base.
  - Contract lines land in this package: the base store in sync.md, beside the other device-local state.
- **Done when:** tests first; core tests pin: base written on first sight and on an outside change, not on an own save, read back, kept when the file is deleted, absent for binary and non-UTF-8 files. `pnpm --filter @labshelf/core test -- writing/merge` and typecheck pass; files ≤ 200 lines.
- **Do not touch:** `packages/vscode`, `packages/browser`, `packages/terminal`; the apps' composition roots, except the line that passes the adapter in.

## 2.2 — Three-way merge of text conflict copies

- **Goal:** merge a sync tool's conflict copy of a project text file into the file without ever dropping text (D3).
- **Read only:** `documents/contracts/sync.md` (conflict-copy section); the conflict-copy handling that plan `folder-sync` session 2 adds under `packages/core/src/library/` (its `index.ts` first); the base-store port from 2.1.
- **Decided:**
  - `mergeText({base, local, other, otherLabel}): {text: string; conflicted: boolean}` in `core/src/writing/merge/`, runtime-neutral: diff3 over lines (`node-diff3` or an equivalent MIT library, after the dependency ladder in AGENTS.md §3).
  - A conflict copy of a text file inside a project with a base: merge into the file, delete the copy, update the base. The file is written before the copy is deleted.
  - Overlapping hunks get `<<<<<<< local` / `=======` / `>>>>>>> <otherLabel>` (the conflict copy's device or tool label) and the path is reported as conflicted.
  - No base, or a binary file: the user's choice (keep mine / keep the other / keep both) from plan `folder-sync`. The local file's line endings are kept.
  - Failures are logged through the injected `ILogger` with project and path, and leave both files on disk.
  - The merge rule lands in sync.md in this package.
- **Done when:** tests first: A3 (edits in paragraphs 1 and 5 merge, copy deleted), A4 (same-line edits leave markers), missing base goes to the user's choice, a failed write keeps the copy, CRLF file stays CRLF. Use real edit histories, not one-liners. Core tests and typecheck pass.
- **Do not touch:** `packages/vscode`, `packages/browser`, `packages/terminal`.
