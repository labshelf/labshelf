# Session 4 — VS Code: share, join, live editing, cursors, disk mirror

- **Goal:** two VS Code users edit one shared project live, each on a local copy, with cursors, own-only undo and disk edits fed back.
- **Starts from:** session 3 committed.
- **Ends with:** A1, A2, A3, A4, A5 observed with two isolated VS Code hosts.
- **Owns:** `packages/core/src/collab/node/`, `packages/core/src/collab/binding/` (if session 1 chose copy or own), `packages/vscode/src/collab/` (not `comments/`), their tests, the `labshelf.collab.*` entries in `packages/vscode/package.json`, one registration call in `packages/vscode/src/extension.ts`.

Runs alone (manifest).

Context: design `documents/plans/project-collaboration/research/collab-model.md`; binding and WebRTC-host decisions `research/reuse-and-transport.md`. VS Code code outside `node/` stays web-safe (`documents/architecture.md#node-code-in-vs-code`).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Disk mirror and device-local state | contract | implementer (opus), tests first | mirror tests | [x] |
| 4.2 | Binding, undo, cursors | behaviour | implementer (opus), tests first for offsets and undo | binding tests | [x] |
| 4.3 | WebRTC host, share and join commands | behaviour | implementer (sonnet) | typecheck | [x] |
| 4.4 | Two-host run | task | main thread, `verify` skill | A1–A5 | [x] |
| 4.5 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [x] |

4.1 and 4.2 in parallel (disjoint: `collab/node/` vs `collab/binding/` and `vscode/src/collab/binding/`); 4.3 after both.

## 4.1 — Disk mirror and device-local state

- **Goal:** project files on disk follow the docs, and outside edits enter the docs.
- **Read only:** `research/collab-model.md` ("Device-local state", "Disk mirror", "Join"); `documents/plans/folder-sync/research/folder-rules-decisions.md`; `packages/core/src/library/node/atomicWrite.ts`; the session-3 session API; the 2.2 model API.
- **Decided:** as in the entry. Yjs state in `<stateDir>/libraries/<key>/collab/<shareId>/` (snapshot + append-only update log, compacted on start). Doc → disk only when text differs, atomic; disk → doc as a character diff in one transaction with origin `disk`; blobs written after hash check. Join creates `projects/<id>/` (usual collision suffix), writes `shared:` into `labshelf.yaml`, then offers the paper import. A file deleted on disk is a delete in the index only after it stays missing for one debounce. Every write and failure is logged.
- **Done when:** tests first on a temp folder: own write is not echoed back; an outside edit becomes a minimal doc edit; a half-written file is ignored until stable; a deleted file propagates; restart restores state without a peer.

## 4.2 — Binding, undo, cursors

- **Goal:** open editors of shared files follow their `Y.Text` both ways.
- **Read only:** `research/reuse-and-transport.md` ("Binding decision", "Binding traps"); the chosen upstream files, if any.
- **Decided:** per session 1's decision. Offsets normalised to `\n`; echo guard per document; remote edits queued per document and applied with retrying `WorkspaceEdit`; a per-user `Y.UndoManager` (tracked origin = this client) replaces `undo`/`redo` in shared documents through keybindings with a `when` context; remote cursors and selections as decorations coloured from the core token palette, with the person's name on hover. Copied upstream code keeps its MIT notice in a `LICENSE-<project>.md` beside it.
- **Done when:** tests first for the pure parts (offset mapping with CRLF, edit queue under races, undo skips remote edits); vscode typecheck passes.

## 4.3 — WebRTC host, share and join commands

- **Goal:** the user shares and joins from VS Code.
- **Read only:** `research/reuse-and-transport.md` ("WebRTC host"); `packages/vscode/src/writing/session/projectSession.ts`; `packages/vscode/src/extension.ts` 50–115; `packages/vscode/package.json` commands section.
- **Decided:** commands only `labshelf.collab.share` ("Share Project…", copies the invite link), `labshelf.collab.join` ("Join Shared Project…", input box), `labshelf.collab.leave`. The transport runs where session 1 decided (a hidden webview bridging `postMessage` or `node-datachannel` under `node/`). Keys in `SecretStorage`. A status bar item shows "Shared · N online" or "Shared · offline", and "relay needed" past 8 peers. Errors toast and log with context.
- **Done when:** vscode typecheck and build pass. No unit test: glue.

## 4.4 — Two-host run

- **Do:** two `@vscode/test-electron` hosts with their own user-data-dirs and libraries (ask the user before launching; stop only the launched PIDs). Check A1–A5, including one host offline for A3 and a `git checkout` of a file for A4.
- **Done when:** A1–A5 reported, with what was not checked.
