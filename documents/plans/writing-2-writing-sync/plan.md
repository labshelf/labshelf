# Plan: writing projects across devices and collaboration

Status: in progress
Size: 3 sessions — a three-way merge for text conflict copies plus collaboration in VS Code

## 1. Goal

A writing project is a plain folder that follows its author across machines through the user's own sync tool, and two authors can work on it together without any LabShelf server: edits made at different times merge when the sync tool leaves a conflict copy, LabShelf notices when a coauthor is editing and offers a live session with shared cursors and chat, and coauthors can leave Overleaf-style comments instead of changing the text.

## 2. Decisions

- [x] **D1** Projects are plain folders. An internal project lives in `<library>/projects/<id>/` and travels with the library folder; a registered external folder travels with whatever sync tool the user puts it in. LabShelf uploads nothing and keeps no sync state inside a project. — The author keeps writing on another machine or in the browser; the git repository stays the user's.
- [x] **D2** The external-project registry is device-local (plan `folder-sync` D4), so on another machine the user registers an external folder again. — External paths are device-local.
- [x] **D3** When the sync tool leaves a conflict copy of a project text file (detected by name per tool, plan `folder-sync` D5), LabShelf merges it three ways into the file and deletes the copy instead of asking the user to choose. Text files are those with a known text extension (`.tex`, `.typ`, `.bib`, `.md`, `.yaml`, `.json`, `.sty`, `.cls`, `.txt`, `.csv`) and valid UTF-8. The base is the content this device last received from outside (or first saw), kept in a device-local base store outside the project folder. Non-overlapping edits merge silently; overlapping ones are written with git-style conflict markers, which VS Code's built-in merge UI resolves. A file with no base, and any binary file, goes to the user's choice from plan `folder-sync` D5. The merge is diff3 over lines in `core/src/writing/merge/` (`node-diff3` or an equivalent MIT library). — Writing in turns never produces duplicate files.
- [x] **D4** When a file of an open project changes on disk without a save in this VS Code, within the last 10 minutes, LabShelf shows "Someone else is editing this project. Start a live session?". The sync tool's delay is accepted, and the author's own second device may also trigger it. — Live collaboration is offered when it matters.
- [x] **D5** Live sessions use Open Collaboration Tools (MIT, public server run by TypeFox, end-to-end encrypted, cursors, follow and chat). LabShelf calls its `oct.createRoom` and `oct.joinRoom` commands and offers to install the extension; the server is self-hostable and the bridge only calls OCT commands. Embedding the OCT protocol library is out. — Real-time editing with no server of our own.
- [x] **D6** Comments live in `<project>/.labshelf/comments.json`, shown with the VS Code Comments API (threads in the gutter, replies, resolve). Each comment is anchored to the quoted text with context (quote, prefix, suffix), not to a line number, and re-anchored on load; an anchor that cannot be found becomes "detached" and stays listed. The file syncs and merges as any text file. — Comments without touching the source.
- [x] **D7** In the reader's review mode, a highlight with a note on the compiled PDF becomes a comment at the source line (SyncTeX). — Reviewing the PDF feeds the same comment threads.
- [x] **D8** Coauthors share a project by sharing its folder through their sync tool (a shared Dropbox, Nextcloud, OneDrive or Google Drive folder). LabShelf adds nothing to sharing: no share command, no exchange file. — Works with any tool the authors already use, with no account of our own.
- [x] **D9** Out of this plan: the browser's project UI ([writing-browser-bridge](../writing-3-writing-browser-bridge/plan.md)), collaboration in the browser editor ([browser-editor](../writing-4-browser-editor/plan.md)), a CRDT, Live Share. Contracts touched: [sync.md](../../contracts/sync.md) (text conflict-copy merge, device-local base store) and [library-format.md](../../contracts/library-format.md) (`.labshelf/comments.json`).
- [x] **D10** A merge never drops text: conflict markers on any overlap, the base store never deletes, tests use real edit histories. VS Code code that uses Node goes where [architecture.md#node-code-in-vs-code](../../architecture.md#node-code-in-vs-code) says: process and disk-path code in a feature's `node/` folder, registered through `writing/node/`; Node data reads through `ProjectDataPort`.

Open: none.

## 3. Acceptance

- [ ] **A1** A project created on machine A appears in machine B's Writing view, with the same files, once the user's sync tool has synced the library folder.
- [ ] **A2** LabShelf writes no sync state into a registered external folder; its git status changes only through the user's edits.
- [ ] **A3** A edits paragraph 1 and B edits paragraph 5 of `main.tex` while their sync tool is offline; after it syncs and leaves a conflict copy, both edits are in one file and the conflict copy is gone.
- [ ] **A4** A and B edit the same line; the file holds conflict markers and VS Code offers Accept Current / Incoming.
- [ ] **A5** With B editing in the shared folder, A sees the coauthor notice once the sync tool delivers B's change; "Start live session" opens an OCT room.
- [ ] **A6** A comment added on a line survives an edit that moves the text, reaches the coauthor through the shared folder and can be resolved.
- [ ] **A7** A note on a highlight in the review PDF appears as a comment on the matching source line.

## 4. Sessions

Sessions run in order, after plan `folder-sync` session 2. 3b and 3c each change `packages/vscode/package.json`, so each runs alone; session 2 runs alone because it may add a dependency to `packages/core/package.json`. A1 and A2 need no session: they hold once plan `folder-sync` lands, and are checked by hand.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 2 | [sessions/2-merge.md](sessions/2-merge.md) | base store, three-way merge of text conflict copies (A3, A4) | `core/src/writing/merge/`, `core/__tests__/writing/merge/`, `sync.md` | alone |
| 3b | [sessions/3b-comments.md](sessions/3b-comments.md) | comments: format, controller, review-PDF note (A6, A7) | `core/src/writing/comments/`, `vscode/src/writing/comments/`, reader preview requests, `library-format.md` | alone |
| 3c | [sessions/3c-live-sessions.md](sessions/3c-live-sessions.md) | coauthor notice and OCT bridge (A5) | `vscode/src/writing/collaboration/`, one call in `extension.ts` | alone |
