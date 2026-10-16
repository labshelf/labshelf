# Plan: writing projects on Drive and collaboration

Status: in progress (session 1 of 4)
Size: GG — a sync contract change (a new namespace and a text merge) plus collaboration in VS Code; 4 sessions, the first with a Drive-scope spike.
Pending decisions: 0

This plan uses the directory format. Read this file, then only the `sessions/NN.md` of the session you run. `log.md` is append-only: add lines with `>>`, never read it whole. Step ids (S4, S5, …) are the same in this plan, the session files and the log.

## 1. Goal

A writing project follows its author across machines through their Google Drive, and two authors can work on it together without any LabShelf server: edits made at different times merge on sync, LabShelf notices when a coauthor is editing and offers a live session with shared cursors and chat, and coauthors can leave Overleaf-style comments instead of changing the text.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md).

## 2. Decisions

- [x] **D1** Projects sync in a new namespace `projects`, a `LabShelf Projects` folder beside `LabShelf Library` on Drive (inside it, the folder would map to `papers/projects/`). Both internal projects and registered external folders are mirrored. Only sources go up: never `.git/`, the build cache, or files matched by the project's ignore list. — The author keeps writing on another machine or in the browser; the git repository stays the user's.
- [x] **D2** On another machine, a project known on Drive but not on disk shows in the Writing view as "Only on Drive — download to…". — External paths are device-local.
- [x] **D3** Text files in projects merge three ways on sync instead of keeping two copies. The base is the content at the last agreed sync, kept in `.research/sync/base/` locally and in IndexedDB in the browser. Non-overlapping edits merge silently; overlapping ones are written with git-style conflict markers, which VS Code's built-in merge UI resolves. Binary files keep the existing keep-both rule. — Writing in turns never produces duplicate files.
- [x] **D4** When the sync sees that another person changed a file of an open project within the last 10 minutes, LabShelf shows "<name> is editing this project. Start a live session?". The source is Drive's `lastModifyingUser`. The ~30 s sync delay is accepted. — Live collaboration is offered when it matters.
- [x] **D5** Live sessions use Open Collaboration Tools (MIT, public server run by TypeFox, end-to-end encrypted, cursors, follow and chat). LabShelf calls its `oct.createRoom` and `oct.joinRoom` commands and offers to install the extension. Embedding the OCT protocol library is out. — Real-time editing with no server of our own.
- [x] **D6** Comments live in `<project>/.labshelf/comments.json`, shown with the VS Code Comments API (threads in the gutter, replies, resolve). Each comment is anchored to the quoted text with context, not to a line number, and re-anchored on load; an anchor that cannot be found becomes "detached" and stays listed. — Comments without touching the source, synced and merged like any file.
- [x] **D7** In the reader's review mode, a highlight with a note on the compiled PDF becomes a comment at the source line (SyncTeX). — Reviewing the PDF feeds the same comment threads.
- [x] **D8** Coauthors exchange a project through one exchange file on Drive that the owner's LabShelf creates and shares, and that the coauthor picks once in Google Picker; each sync merges the other author's changes from it. The exchange sits behind one core port so another transport (such as GitHub) can be added when users ask for it; only the Drive one is built. — Works for any number of users under `drive.file`, with no second account.

Answered:

- **Q1** How a coauthor's LabShelf gets access to a shared project under the `drive.file` scope — **neither option works as written.** `drive.file` grants are per person and per file: sharing a folder grants the coauthor's app nothing, picking the folder in Google Picker grants the folder alone (not its children, nor files added later), and a file one author's app creates in a shared folder stays invisible to the other's app. A file the coauthor picks once in Picker stays readable and writable across later updates by either side, and its `lastModifyingUser` names the other author. **Consequence:** per-file mirroring to a coauthor through Drive is not possible, and the full `drive` scope is out because the apps ship publicly (100-user cap, yearly security assessment). Decided in D8. Picker runs only in a browser page signed in to Google and needs an API key and the Picker API on the LabShelf Cloud project. Evidence: S1 in [log.md](log.md).

## 3. Scope

- **In:** core sync (namespace, base store, text merge), VS Code (Writing view states, coauthor notice, OCT bridge, comments), the reader (note to comment).
- **Out:** the browser's project sync and UI ([writing-browser-bridge](../writing-3-writing-browser-bridge/plan.md)); collaboration in the browser editor ([browser-editor](../writing-4-browser-editor/plan.md)); a CRDT; Live Share.
- **Contracts touched:** [sync.md](../../contracts/sync.md) (namespace `projects`, base store, merge rule, ignore list); [library-format.md](../../contracts/library-format.md) (`.labshelf/comments.json`, `.research/sync/base/`).

## 4. Acceptance criteria

- [ ] **A1** A project created on machine A appears on machine B after a sync as "Only on Drive", and downloads with the same files and no `.git/` or ignored paths.
- [ ] **A2** A registered external folder is mirrored without any change to the folder or its git status.
- [ ] **A3** A edits paragraph 1 and B edits paragraph 5 of `main.tex` between syncs; after both sync, both edits are in one file and no conflict copy exists.
- [ ] **A4** A and B edit the same line; the file holds conflict markers and VS Code offers Accept Current / Incoming.
- [ ] **A5** With B editing, A sees the coauthor notice within one sync; "Start live session" opens an OCT room.
- [ ] **A6** A comment added on a line survives an edit that moves the text, syncs to the coauthor and can be resolved.
- [ ] **A7** A note on a highlight in the review PDF appears as a comment on the matching source line.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| `projects` namespace, ignore rules | `core/src/sync/` | same engine; namespace maps `<library>/projects/` and each registered folder to `projects/<id>/` |
| base store | `core/src/sync/` + `core/src/sync/node/` | content of each text file at the last agreed state; port with a Node and an IndexedDB adapter |
| three-way text merge | `core/src/sync/merge/` | diff3 over lines (`node-diff3` or an equivalent MIT library); conflict markers `<<<<<<< local` / `=======` / `>>>>>>> <coauthor>` |
| coauthor activity | `core/src/sync/` | from Drive file metadata after each run |
| comments format and anchoring | `core/src/writing/comments/` | quote + prefix + suffix; fuzzy re-anchor |
| OCT bridge, comment controller, notice | `packages/vscode/src/writing/` | |

Text files are those with a known text extension (`.tex`, `.typ`, `.bib`, `.md`, `.yaml`, `.json`, `.sty`, `.cls`, `.txt`, `.csv`) and valid UTF-8.

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | projects on Drive: S1–S3 done (A1, A2 in core); S4 Only-on-Drive row and S5 finish open | yes, one per step |
| 2 | [sessions/02.md](sessions/02.md) | merge: base store, three-way text merge (A3, A4) | yes |
| 3 | [sessions/03.md](sessions/03.md) | coauthors and live sessions: exchange file, notice, OCT bridge (A5) | yes |
| 4 | [sessions/04.md](sessions/04.md) | comments: format, controller, review-PDF note (A6, A7) | yes |

Runner tiers:

- **H**: the session model (Opus or Fable). Use it for design, algorithms and judgment.
- **M**: Sonnet. Use it for well-specified implementation, moves and tests.
- **L**: Haiku. Use it for gates, import fixes and commits.

## 7. Risks

- **R1** `drive.file` does not reach a coauthor's shared files. — S1 spike before any design depends on it.
- **R2** A merge silently drops text. — Conflict markers on any overlap; the base store never deletes; tests on real edit histories.
- **R3** The OCT public server changes terms or disappears. — It is self-hostable; the bridge only calls OCT commands.

## 8. Log

See [log.md](log.md).
