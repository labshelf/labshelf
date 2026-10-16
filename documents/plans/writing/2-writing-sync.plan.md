# Plan: writing projects on Drive and collaboration

Status: in progress (session 1 of 4)
Size: GG — a sync contract change (a new namespace and a text merge) plus collaboration in VS Code; 4 sessions, the first with a Drive-scope spike.
Pending decisions: 1 (Q1, answered by S1)

## 1. Goal

A writing project follows its author across machines through their Google Drive, and two authors can work on it together without any LabShelf server: edits made at different times merge on sync, LabShelf notices when a coauthor is editing and offers a live session with shared cursors and chat, and coauthors can leave Overleaf-style comments instead of changing the text.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md).

## 2. Decisions

- [x] **D1** Projects sync in a new namespace `projects`, a `projects/` folder inside `LabShelf Library` on Drive. Both internal projects and registered external folders are mirrored. Only sources go up: never `.git/`, the build cache, or files matched by the project's ignore list. — The author keeps writing on another machine or in the browser; the git repository stays the user's.
- [x] **D2** On another machine, a project known on Drive but not on disk shows in the Writing view as "Only on Drive — download to…". — External paths are device-local.
- [x] **D3** Text files in projects merge three ways on sync instead of keeping two copies. The base is the content at the last agreed sync, kept in `.research/sync/base/` locally and in IndexedDB in the browser. Non-overlapping edits merge silently; overlapping ones are written with git-style conflict markers, which VS Code's built-in merge UI resolves. Binary files keep the existing keep-both rule. — Writing in turns never produces duplicate files.
- [x] **D4** When the sync sees that another person changed a file of an open project within the last 10 minutes, LabShelf shows "<name> is editing this project. Start a live session?". The source is Drive's `lastModifyingUser`. The ~30 s sync delay is accepted. — Live collaboration is offered when it matters.
- [x] **D5** Live sessions use Open Collaboration Tools (MIT, public server run by TypeFox, end-to-end encrypted, cursors, follow and chat). LabShelf calls its `oct.createRoom` and `oct.joinRoom` commands and offers to install the extension. Embedding the OCT protocol library is out. — Real-time editing with no server of our own.
- [x] **D6** Comments live in `<project>/.labshelf/comments.json`, shown with the VS Code Comments API (threads in the gutter, replies, resolve). Each comment is anchored to the quoted text with context, not to a line number, and re-anchored on load; an anchor that cannot be found becomes "detached" and stays listed. — Comments without touching the source, synced and merged like any file.
- [x] **D7** In the reader's review mode, a highlight with a note on the compiled PDF becomes a comment at the source line (SyncTeX). — Reviewing the PDF feeds the same comment threads.

Open (blocks approval):

- **Q1** How a coauthor's LabShelf gets access to a shared project under the `drive.file` scope — options: Google Picker grants access to the shared folder / each author syncs their own copy and LabShelf exchanges changes through a shared folder only for the merge; recommendation: decide after the S1 spike, which checks whether Picker access to a folder covers its children.

## 3. Scope

- **In:** core sync (namespace, base store, text merge), VS Code (Writing view states, coauthor notice, OCT bridge, comments), the reader (note to comment).
- **Out:** the browser's project sync and UI ([writing-browser-bridge](3-writing-browser-bridge.plan.md)); collaboration in the browser editor ([browser-editor](4-browser-editor.plan.md)); a CRDT; Live Share.
- **Contracts touched:** [sync.md](../../contracts/sync.md) (namespace `projects`, base store, merge rule, ignore list); [library-format.md](../../contracts/library-format.md) (`.labshelf/comments.json`, `.research/sync/base/`).

## 4. Acceptance criteria

- [ ] **A1** A project created on machine A appears on machine B after a sync, with the same files and no build cache or `.git/`.
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

## 6. Sessions and steps

### Session 1 — projects on Drive

- **Starts from:** writing-core done; clean tree.
- **Ends with:** A1, A2; Q1 answered.
- **Commit:** yes, one per step

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Spike: shared folder access under `drive.file` (Picker) | — | H · main thread | Q1 answered in §8 | [ ] |
| S2 | Contract: `projects` namespace, ignore list, base store | S1 | H · main thread | sync.md and library-format.md updated | [ ] |
| S3 | Engine: `projects` namespace for internal and external projects | S2 | M · implementer (sonnet) | A1, A2 | [ ] |
| S4 | Writing view: "Only on Drive — download to…" | S3 | M · implementer (sonnet) | D2 | [ ] |
| S5 | Finish, plus a scratch-Drive run | S1–S4 | `finish` skill | gate passes | [ ] |

### Session 2 — merge

- **Starts from:** session 1 committed
- **Ends with:** A3, A4
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S6 | Base store with Node adapter | S3 | M · implementer (sonnet) | core tests | [ ] |
| S7 | Three-way merge in the conflict branch of the diff for text files | S6 | H · main thread | A3, A4 in core tests | [ ] |
| S8 | Finish, plus a two-machine run on a scratch Drive | S6–S7 | `finish` skill | gate passes | [ ] |

### Session 3 — coauthors and live sessions

- **Starts from:** session 2 committed
- **Ends with:** A5
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S9 | Share project with a coauthor (per Q1) | Q1 | H · main thread | coauthor syncs the project | [ ] |
| S10 | Coauthor activity from Drive metadata; notice | S9 | M · implementer (sonnet) | A5 (notice) | [ ] |
| S11 | OCT bridge | S10 | M · implementer (sonnet) | A5 | [ ] |
| S12 | Finish | S9–S11 | `finish` skill | gate passes | [ ] |

### Session 4 — comments

- **Starts from:** session 3 committed
- **Ends with:** A6, A7
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S13 | Comments format and anchoring | — | H · main thread | core tests with moved and deleted text | [ ] |
| S14 | Comment controller in VS Code | S13 | M · implementer (sonnet) | A6 | [ ] |
| S15 | Review-PDF note to comment | S14 | M · implementer (sonnet) | A7 | [ ] |
| S16 | Finish | S13–S15 | `finish` skill | gate passes | [ ] |

### Step blocks

#### S1 — Drive access spike

- **Do:** with two test Google accounts and the LabShelf OAuth client, share a folder created by account A with B; check what B's app can list and read under `drive.file`, with and without selecting the folder in Google Picker.
- **Context:** the broader `drive` scope is restricted and needs a paid security assessment, so it is not an option.
- **Done when:** §8 records the result and Q1's answer.

#### S2 — Contract

- **Do:** add the `projects` namespace, the ignore list (`.git/`, `.labshelf/cache/`, `*.pdf` of the main only if the user opts out, plus `labshelf.yaml` `ignore:` patterns), the base store and the merge rule to `sync.md`; add the files to `library-format.md`.

#### S3 — Engine

- **Do:** extend the engine and the folder-name rules to the `projects` namespace; a registered folder maps to `projects/<id>/` on Drive; never write inside `.git/`.
- **Done when:** A1, A2 against the sync fakes and on a scratch Drive.

#### S7 — Merge

- **Do:** in the "both changed" case for a text file, read base, local and remote, merge, write the result locally, upload it and update the base; overlapping hunks get conflict markers and the run reports them as conflicts.
- **Done when:** core tests for clean merge, overlapping edits, a missing base (falls back to keep-both) and CRLF files.

#### S9–S11 — Coauthors

- **Do:** a "Share project" action (per Q1); after each sync, compare each project file's `lastModifyingUser` with the signed-in user; show the D4 notice once per coauthor per hour; "Start live session" runs `oct.createRoom` or offers to install OCT.

#### S13–S15 — Comments

- **Do:** `comments.json` shape `{threads: [{id, file, anchor: {quote, prefix, suffix}, comments: [{author, body, createdAt}], resolved}]}` with stable key order; re-anchor by exact quote then fuzzy match; a CommentController per project; the reader's note on a highlight in review mode creates a thread at the SyncTeX source line.

## 7. Risks

- **R1** `drive.file` does not reach a coauthor's shared files. — S1 spike before any design depends on it.
- **R2** A merge silently drops text. — Conflict markers on any overlap; the base store never deletes; tests on real edit histories.
- **R3** The OCT public server changes terms or disappears. — It is self-hostable; the bridge only calls OCT commands.

## 8. Log
