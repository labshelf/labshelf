# Plan: writing projects on Drive and collaboration

Status: in progress
Size: 5 sessions — a sync contract change (a new namespace and a text merge) plus collaboration in VS Code

## 1. Goal

A writing project follows its author across machines through their Google Drive, and two authors can work on it together without any LabShelf server: edits made at different times merge on sync, LabShelf notices when a coauthor is editing and offers a live session with shared cursors and chat, and coauthors can leave Overleaf-style comments instead of changing the text.

## 2. Decisions

- [x] **D1** Projects sync in a new namespace `projects`, a `LabShelf Projects` folder beside `LabShelf Library` on Drive (inside it, the folder would map to `papers/projects/`). Both internal projects and registered external folders are mirrored; the namespace maps `<library>/projects/` and each registered folder to `projects/<id>/`. Only sources go up: never `.git/`, the build cache, or files matched by the project's ignore list. — The author keeps writing on another machine or in the browser; the git repository stays the user's.
- [x] **D2** On another machine, a project known on Drive but not on disk shows in the Writing view as "Only on Drive — download to…". — External paths are device-local.
- [x] **D3** Text files in projects merge three ways on sync instead of keeping two copies. Text files are those with a known text extension (`.tex`, `.typ`, `.bib`, `.md`, `.yaml`, `.json`, `.sty`, `.cls`, `.txt`, `.csv`) and valid UTF-8. The base is the content at the last agreed sync, kept in `.research/sync/base/` locally (never synced) and in IndexedDB in the browser. Non-overlapping edits merge silently; overlapping ones are written with git-style conflict markers, which VS Code's built-in merge UI resolves. Binary files keep the existing keep-both rule. The merge is diff3 over lines in `core/src/sync/merge/` (`node-diff3` or an equivalent MIT library). — Writing in turns never produces duplicate files.
- [x] **D4** When the sync sees that another person changed a file of an open project within the last 10 minutes, LabShelf shows "<name> is editing this project. Start a live session?". The source is Drive's `lastModifyingUser`. The ~30 s sync delay is accepted. — Live collaboration is offered when it matters.
- [x] **D5** Live sessions use Open Collaboration Tools (MIT, public server run by TypeFox, end-to-end encrypted, cursors, follow and chat). LabShelf calls its `oct.createRoom` and `oct.joinRoom` commands and offers to install the extension; the server is self-hostable and the bridge only calls OCT commands. Embedding the OCT protocol library is out. — Real-time editing with no server of our own.
- [x] **D6** Comments live in `<project>/.labshelf/comments.json`, shown with the VS Code Comments API (threads in the gutter, replies, resolve). Each comment is anchored to the quoted text with context (quote, prefix, suffix), not to a line number, and re-anchored on load; an anchor that cannot be found becomes "detached" and stays listed. The file syncs and merges as any text file. — Comments without touching the source.
- [x] **D7** In the reader's review mode, a highlight with a note on the compiled PDF becomes a comment at the source line (SyncTeX). — Reviewing the PDF feeds the same comment threads.
- [x] **D8** Coauthors exchange a project through one exchange file on Drive that the owner's LabShelf creates and shares, and that the coauthor picks once in Google Picker; each sync merges the other author's changes from it. The exchange sits behind one core port so another transport (such as GitHub) can be added when users ask for it; only the Drive one is built. — Works for any number of users under `drive.file`, with no second account. Reason: `drive.file` grants are per person and per file, so sharing or picking a folder gives the coauthor's app nothing beyond the folder, and a file one author's app creates in a shared folder stays invisible to the other's app; a file the coauthor picks once stays readable and writable across later updates, and its `lastModifyingUser` names the other author. The full `drive` scope is out because the apps ship publicly (100-user cap, yearly security assessment). Evidence: S1 in [log.md](log.md).
- [x] **D9** Out of this plan: the browser's project sync and UI ([writing-browser-bridge](../writing-3-writing-browser-bridge/plan.md)), collaboration in the browser editor ([browser-editor](../writing-4-browser-editor/plan.md)), a CRDT, Live Share. Contracts touched: [sync.md](../../contracts/sync.md) (namespace `projects`, base store, merge rule, ignore list) and [library-format.md](../../contracts/library-format.md) (`.labshelf/comments.json`, `.research/sync/base/`).
- [x] **D10** A merge never drops text: conflict markers on any overlap, the base store never deletes, tests use real edit histories. VS Code code that uses Node goes where [architecture.md#node-code-in-vs-code](../../architecture.md#node-code-in-vs-code) says: process and disk-path code in a feature's `node/` folder, registered through `writing/node/`; Node data reads through `ProjectDataPort`.

Open (blocks session 3a):

- **Q1** Where the coauthor's Picker page runs — a static page the VS Code extension serves on loopback and opens in the user's browser / the browser extension's own page; recommendation: the loopback page, because a VS Code user needs no second install. Either way the page runs in a browser signed in to Google and needs an API key and the Picker API on the LabShelf Cloud project. The answer goes into session 3a's package 3a.1 before it is delegated.

## 3. Acceptance

- [ ] **A1** A project created on machine A appears on machine B after a sync as "Only on Drive", and downloads with the same files and no `.git/` or ignored paths.
- [ ] **A2** A registered external folder is mirrored without any change to the folder or its git status.
- [ ] **A3** A edits paragraph 1 and B edits paragraph 5 of `main.tex` between syncs; after both sync, both edits are in one file and no conflict copy exists.
- [ ] **A4** A and B edit the same line; the file holds conflict markers and VS Code offers Accept Current / Incoming.
- [ ] **A5** With B editing, A sees the coauthor notice within one sync; "Start live session" opens an OCT room.
- [ ] **A6** A comment added on a line survives an edit that moves the text, syncs to the coauthor and can be resolved.
- [ ] **A7** A note on a highlight in the review PDF appears as a comment on the matching source line.

## 4. Sessions

Sessions run in order. 3a, 3b and 3c each change `packages/vscode/package.json`, so each runs alone; session 2 runs alone because it may add a dependency to `packages/core/package.json`.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | "Only on Drive" row in the Writing view (A1, A2) | `vscode/src/writing/`, `vscode/src/sync/adapter/` | alone |
| 2 | [sessions/2-merge.md](sessions/2-merge.md) | base store, three-way text merge, coauthor type (A3, A4) | `core/src/sync/`, `core/__tests__/sync/`, `sync.md`, `library-format.md` | alone |
| 3a | [sessions/3a-exchange.md](sessions/3a-exchange.md) | exchange file: share a project, coauthor activity in the run result | `core/src/sync/`, `vscode/src/sync/`, `registerSyncCommands.ts`, `sync.md` | alone |
| 3b | [sessions/3b-comments.md](sessions/3b-comments.md) | comments: format, controller, review-PDF note (A6, A7) | `core/src/writing/comments/`, `vscode/src/writing/comments/`, reader preview requests, `library-format.md` | alone |
| 3c | [sessions/3c-live-sessions.md](sessions/3c-live-sessions.md) | coauthor notice and OCT bridge (A5) | `vscode/src/writing/collaboration/`, one call in `extension.ts` | alone |
