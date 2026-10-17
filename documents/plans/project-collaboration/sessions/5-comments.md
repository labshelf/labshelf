# Session 5 — Anchored comments, live and on disk

- **Goal:** authors comment on source text with threads that stay attached as the text moves, live for collaborators and saved in the project, and a note on a highlight in the review PDF becomes a thread at its source line.
- **Starts from:** session 4 committed; this session takes over writing-2-writing-sync's comments session (D15).
- **Ends with:** A6; the review-PDF note works in shared and unshared projects.
- **Owns:** `packages/core/src/collab/comments/`, `packages/core/__tests__/collab/comments/`, `packages/vscode/src/collab/comments/`, `packages/core/src/reader/previewRequests.ts`, `packages/core/src/reader/host/{ports,previewMessages}.ts`, the review-note piece of `packages/core/src/reader/dom/`, `packages/vscode/src/writing/preview/sourceLinks/`, the `labshelf.comment.*` entries in `packages/vscode/package.json`, the comments sections of `documents/contracts/{collaboration,library-format}.md`.

Runs alone (manifest).

Context: design `documents/plans/project-collaboration/research/collab-model.md` ("Comments"). Comments use the VS Code Comments API (gutter threads, replies, resolve).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 5.1 | Comment model, anchors, `comments.json` | contract | implementer (opus), tests first → `architecture-reviewer` | anchor tests | [ ] |
| 5.2 | Comments UI design | — | `ui-design` skill | design approved by the user | [ ] |
| 5.3 | Comment controller | behaviour | implementer (sonnet) | typecheck | [ ] |
| 5.4 | Review-PDF note to comment | behaviour | implementer (sonnet) | payload test | [ ] |
| 5.5 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

5.1 and 5.2 in parallel; 5.3 after both; 5.4 after 5.3.

## 5.1 — Model, anchors and `comments.json`

- **Goal:** one comment store that works live (index doc) and on disk.
- **Read only:** `research/collab-model.md`; `documents/contracts/library-format.md` 193–212 (checklist rules to mirror); `packages/core/src/writing/checklist/checklistFile.ts` 1–77; the 2.2 index-doc API.
- **Decided:**
  - Thread `{id, file, anchor: {quote, prefix, suffix}, comments: [{id, author, body, createdAt}], resolved}`; in a shared project the live anchor adds Yjs relative positions `{start, end}` (base64) and the thread lives in the index doc's `comments` map.
  - `<project>/.labshelf/comments.json` = `{threads: [...]}`, stable key order, two-space indent, one thread per block; written from the map in shared projects, read and written directly in unshared ones.
  - Re-anchor: relative positions when they resolve, else exact quote with context, else fuzzy; not found → `detached`, still listed.
  - Invalid entries kept on rewrite, unknown keys preserved, a file that is not a valid object (conflict markers included) is reported and never overwritten.
- **Done when:** tests first: anchor survives a move live and on disk; deleted quote → detached; two clients add threads concurrently and both survive; conflict-marked file never overwritten. Contract sections written before code.

## 5.2 — Comments UI design

- **Goal:** how threads, authors (name, colour), resolved threads and detached threads look in the gutter, the Comments panel and hover, within the VS Code Comments API and the core tokens.
- **Done when:** the user approves the design; the decisions go into 5.3's brief.

## 5.3 — Comment controller

- **Read only:** 5.1 API; 5.2 decisions; `packages/vscode/src/collab/` session API from session 4; `packages/vscode/package.json` commands section.
- **Decided:** one `CommentController` per open project; commands only `labshelf.comment.reply`, `labshelf.comment.resolve`, `labshelf.comment.reopen`; exports `addSourceComment({projectFolder, file, line, quote, body})`. Errors toast and log.
- **Done when:** vscode typecheck passes. No test: glue.

## 5.4 — Review-PDF note to comment

- **Read only:** `packages/core/src/reader/previewRequests.ts` 25–102; `packages/core/src/reader/host/ports.ts` 27–58; `packages/core/src/reader/host/previewMessages.ts` 17–91; `packages/vscode/src/writing/preview/sourceLinks/showSource.ts` 1–42; `packages/core/src/writing/synctex/sourceAt.ts` 1–54.
- **Decided:** a note added on a highlight in a preview sends `addReviewComment {point, quote, note}`; the host maps the point to a source line with SyncTeX and calls `addSourceComment`; no hit → toast and log with the point. The payload is validated at the boundary.
- **Done when:** one core test pins payload validation; core and vscode typecheck pass.
