# Plan: writing projects across devices

Status: in progress
Size: 1 session — a three-way merge for text conflict copies

## 1. Goal

A writing project is a plain folder that follows its author across machines through the user's own sync tool, and edits made at different times merge when the sync tool leaves a conflict copy. Live editing, comments and sharing with other users are plan [project-collaboration](../project-collaboration/plan.md).

## 2. Decisions

- [x] **D1** Projects are plain folders. An internal project lives in `<library>/projects/<id>/` and travels with the library folder; a registered external folder travels with whatever sync tool the user puts it in. LabShelf uploads nothing and keeps no sync state inside a project. — The author keeps writing on another machine or in the browser; the git repository stays the user's.
- [x] **D2** The external-project registry is device-local (plan `folder-sync` D4), so on another machine the user registers an external folder again. — External paths are device-local.
- [x] **D3** When the sync tool leaves a conflict copy of a project text file (detected by name per tool, plan `folder-sync` D5), LabShelf merges it three ways into the file and deletes the copy instead of asking the user to choose. Text files are those with a known text extension (`.tex`, `.typ`, `.bib`, `.md`, `.yaml`, `.json`, `.sty`, `.cls`, `.txt`, `.csv`) and valid UTF-8. The base is the content this device last received from outside (or first saw), kept in a device-local base store outside the project folder. Non-overlapping edits merge silently; overlapping ones are written with git-style conflict markers, which VS Code's built-in merge UI resolves. A file with no base, and any binary file, goes to the user's choice from plan `folder-sync` D5. The merge is diff3 over lines in `core/src/writing/merge/` (`node-diff3` or an equivalent MIT library). — Writing in turns never produces duplicate files.
- [x] **D4** When a file of an open project changes on disk without a save in this VS Code, within the last 10 minutes, LabShelf shows "Someone else is editing this project. Start a live session?". The sync tool's delay is accepted, and the author's own second device may also trigger it. — Live collaboration is offered when it matters.
- [x] **D9** Out of this plan: the browser's project UI ([writing-browser-bridge](../browser-writing-companion/plan.md)), live collaboration and comments ([project-collaboration](../project-collaboration/plan.md)). Contracts touched: [sync.md](../../contracts/sync.md) (text conflict-copy merge, device-local base store).
- [x] **D10** A merge never drops text: conflict markers on any overlap, the base store never deletes, tests use real edit histories. VS Code code that uses Node goes where [architecture.md#node-code-in-vs-code](../../architecture.md#node-code-in-vs-code) says: process and disk-path code in a feature's `node/` folder, registered through `writing/node/`; Node data reads through `ProjectDataPort`.

Open: none.

## 3. Acceptance

- [ ] **A1** A project created on machine A appears in machine B's Writing view, with the same files, once the user's sync tool has synced the library folder.
- [ ] **A2** LabShelf writes no sync state into a registered external folder; its git status changes only through the user's edits.
- [ ] **A3** A edits paragraph 1 and B edits paragraph 5 of `main.tex` while their sync tool is offline; after it syncs and leaves a conflict copy, both edits are in one file and the conflict copy is gone.
- [ ] **A4** A and B edit the same line; the file holds conflict markers and VS Code offers Accept Current / Incoming.

## 4. Sessions

Session 2 runs after plan `folder-sync` session 2, alone because it may add a dependency to `packages/core/package.json`. A1 and A2 need no session: they hold once plan `folder-sync` lands, and are checked by hand.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 2 | [sessions/2-merge.md](sessions/2-merge.md) | base store, three-way merge of text conflict copies (A3, A4) | `core/src/writing/merge/`, `core/__tests__/writing/merge/`, `sync.md` | alone |
