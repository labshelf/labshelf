# Session 3b — comments and review-PDF notes

- **Goal:** authors comment on the source text with threads that stay attached when the text moves, and a note on a highlight in the review PDF becomes a thread at its source line.
- **Starts from:** session 2 committed (a sync tool's conflict copy of `comments.json` merges three ways as any project text file).
- **Ends with:** A6 "A comment added on a line survives an edit that moves the text, reaches the coauthor through the shared folder and can be resolved." and A7 "A note on a highlight in the review PDF appears as a comment on the matching source line."
- **Owns:** `packages/core/src/writing/comments/`, `packages/core/src/writing/index.ts`, `packages/core/__tests__/writing/comments/`, `packages/core/src/reader/previewRequests.ts`, `packages/core/src/reader/host/ports.ts`, `packages/core/src/reader/host/previewMessages.ts`, the review-note piece of `packages/core/src/reader/dom/`, `packages/vscode/src/writing/comments/`, `packages/vscode/src/writing/preview/sourceLinks/`, `packages/vscode/src/activation/registration/registerWritingView.ts`, the matching `__tests__/`, `documents/contracts/library-format.md`, the `labshelf.comment.*` entries in `packages/vscode/package.json`

Runs alone: it changes `packages/vscode/package.json`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3b.1 | `comments.json` format and anchoring | contract | implementer (opus), tests first → architecture-reviewer | anchor tests | [ ] |
| 3b.2 | Comment controller in VS Code | behaviour | implementer (sonnet) | typecheck | [ ] |
| 3b.3 | Review-PDF note to comment | behaviour | implementer (sonnet) | payload test, typecheck | [ ] |
| 3b.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3b.1 — Format and anchoring

- **Goal:** comments anchored to quoted text survive edits that move it.
- **Read only:** `documents/contracts/library-format.md` 186–222 (state and checklist files: validation and preservation rules to mirror); `packages/core/src/writing/checklist/checklistFile.ts` 1–77; `packages/core/src/writing/checklist/index.ts`; `packages/core/src/writing/index.ts` 1–20.
- **Decided:**
  - A comment is anchored to the quoted text with its context (quote, prefix, suffix), never to a line number, and is re-anchored on load.
  - `<project>/.labshelf/comments.json` = `{threads: [{id, file, anchor: {quote, prefix, suffix}, comments: [{author, body, createdAt}], resolved}]}`, stable key order, two-space indent, one thread object per block so a line merge of different threads is clean. The file travels with the project folder and merges as any text file; comments add nothing to the merge.
  - Re-anchor by exact quote, then fuzzy match; not found → `detached`, still listed.
  - Invalid entries are kept on rewrite; unknown keys are preserved; a file that is not a valid object (including one with conflict markers) is reported and never overwritten.
  - The format section lands in library-format.md in this package, before code.
- **Done when:** tests first: the anchor survives a move (A6), a deleted quote becomes detached, a conflict-marked file is never overwritten. Core typecheck and `writing/comments` tests pass.
- **Do not touch:** `packages/core/src/writing/merge/`, `documents/contracts/sync.md`.

## 3b.2 — Comment controller

- **Goal:** threads in the gutter, replies and resolve through the VS Code Comments API.
- **Read only:** `packages/vscode/src/activation/registration/registerWritingView.ts` 144–203; `packages/vscode/src/writing/session/projectStore.ts`; `packages/vscode/package.json` 536–560; the 3b.1 API.
- **Decided:**
  - One `CommentController` per open project in `packages/vscode/src/writing/comments/`, registered from `registerWritingView.ts`; it reads and writes only through the 3b.1 API.
  - Manifest entries are only the commands `labshelf.comment.reply`, `labshelf.comment.resolve` and `labshelf.comment.reopen`.
  - The controller exports `addSourceComment({projectFolder, file, line, quote, body}): Promise<void>`, which adds a thread (or a reply to the thread on that block) for 3b.3.
  - Errors show a toast and log with context.
- **Done when:** `pnpm --filter @labshelf/vscode typecheck` passes. No test: this is glue over the tested 3b.1 API.
- **Do not touch:** `extension.ts`.

## 3b.3 — Review-PDF note to comment

- **Goal:** a highlight with a note on the compiled PDF becomes a thread at its source line.
- **Read only:** `packages/core/src/reader/previewRequests.ts` 25–102; `packages/core/src/reader/host/ports.ts` 27–58; `packages/core/src/reader/host/previewMessages.ts` 17–91; `packages/vscode/src/writing/preview/sourceLinks/showSource.ts` 1–42; `packages/core/src/writing/synctex/sourceAt.ts` 1–54; `addSourceComment` from 3b.2.
- **Decided:**
  - The reader has no review mode: a note added on a highlight in a preview sends an `addReviewComment` preview request `{point, quote, note}`.
  - The host maps the point to a source line with SyncTeX and calls `addSourceComment`. No SyncTeX hit → toast plus a log entry with the point.
  - The request payload is validated at the boundary: a missing or non-string `quote` or `note`, or a malformed `point`, is rejected and logged.
- **Done when:** one core test pins the payload validation; the rest is glue with no test. Core and vscode typecheck pass.
- **Do not touch:** `packages/browser`, `packages/terminal`.
