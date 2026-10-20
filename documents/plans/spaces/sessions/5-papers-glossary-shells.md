# Session 5 — Papers and Glossary tabs, positioned tabs, chat panel

- **Goal:** the remaining Space tabs in core: Papers and Glossary working, Notes, Discussions and Discover positioned, and the Research chat panel positioned.
- **Starts from:** session 4 committed.
- **Ends with:** every Space surface exists in core (A2, A3, A7, A9, A10, A11 in core).
- **Owns:** `packages/core/src/spaces/dom/{papers,glossary,positioned,chat}/`, their tests.

Runs alone. Codebase facts: [research/codebase-core.md](../research/codebase-core.md). Design: [research/ui-design.md](../research/ui-design.md). Each package replaces the empty-state mount session 4 left in its folder.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 5.1 | Papers tab | behaviour | implementer (sonnet) | tests pass | [ ] |
| 5.2 | Glossary tab | behaviour | implementer (sonnet) | tests pass | [ ] |
| 5.3 | Notes, Discussions, Discover positioned | task | implementer (sonnet) | renders, typecheck passes | [ ] |
| 5.4 | Research chat panel positioned | task | implementer (sonnet) | renders, typecheck passes | [ ] |
| 5.5 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

All four run in parallel.

## 5.1 — Papers tab

- **Goal:** the Space's references in its own folders, managed in full.
- **Read only:** `packages/core/src/spaces/dom/papers/index.ts`; `packages/core/src/spaces/protocol/` and `view/` papers tree; the core paper row and `statusMark` (`packages/core/src/library-ui/dom/list/paperRow.ts`, `ui/icons/`); `research/ui-design.md`; `research/mockup-reuse.md` (`space/papers.js`, `space/papers.css`).
- **Decided:** a folder pane and a list of reference rows that look like Library rows (title, authors, year, status). Actions: Add papers (picker over `listPapers`, multi-select, into the current folder), New folder, rename and delete folder (references move up, confirm), move a reference (drag onto a folder and a "Move to folder" menu), Remove from Space, mark or unmark in focus. Click selects (`selectPaper`, the app's Details); double-click or Enter opens (`openPaper`). Missing reference: "Not in your Library" with Remove. The open folder follows the sidebar's `openSpace(id, folder)`.
- **Done when:** jsdom tests: each action posts its message; a missing reference shows Remove only. Core typecheck and test pass.

## 5.2 — Glossary tab

- **Goal:** manual terms in full, suggestions and the generated file positioned.
- **Read only:** `packages/core/src/spaces/dom/glossary/index.ts`; `packages/core/src/spaces/protocol/`; `documents/contracts/spaces.md#glossaryjson`; `research/ui-design.md`; `research/mockup-reuse.md` (`glossary/glossary.{js,css}`; conflict detection is new).
- **Decided:** list of terms (symbol, term, definition, source "paper, p. n" that opens the paper); Add term and Edit in one dialog (term and definition required; symbol, source paper by picker, page optional); Delete with confirm. Two terms with one symbol both show the conflict notice. The Suggested column and "Generate labshelf-glossary.tex" are positioned.
- **Done when:** jsdom tests: required fields block save; edit posts `updateTerm`; the conflict notice shows on both terms. Core typecheck and test pass.

## 5.3 — Notes, Discussions, Discover positioned

- **Goal:** the three tabs in the mockup's layout with empty states and positioned controls, no data.
- **Read only:** `packages/core/src/spaces/dom/positioned/index.ts`; `research/ui-design.md`; `research/mockup-reuse.md` (Notes, Discussions, Discover rows: layout plus CSS).
- **Decided:** Notes: New note, Space notes and Paper notes groups. Discussions: New topic, Topics / Decisions / Tasks switch, search, topic list and thread area. Discover: search, filters (All, Gaps, For this project, Later versions), the feed area, arXiv alerts and Watch cards. Every control is positioned; every list shows its empty state. One file per tab.
- **Done when:** each tab renders in a jsdom smoke test; no control is enabled; core typecheck passes.

## 5.4 — Research chat panel positioned

- **Goal:** `mountResearchChat(el, { context })` in the mockup's layout: context (the active Space or project name), Add context, three suggestions, composer, privacy line.
- **Read only:** `packages/core/src/spaces/dom/chat/index.ts`; `research/ui-design.md`; `research/mockup-reuse.md` (`chat/chat.{js,css}`).
- **Decided:** a `setContext(name | null)` method; suggestions, Add context and the composer are positioned; the footer reads "No model connected". No network code.
- **Done when:** jsdom smoke test: context updates; nothing is enabled. Core typecheck passes.

## 5.5 — Check, commit

`check` on Owns. Commit: `Add the Spaces Papers and Glossary tabs and positioned screens`.
