# Session 3 — UI foundations

- **Goal:** the design decisions and the generic core widgets and icons the Spaces screens need, so sessions 4–5 only compose.
- **Starts from:** session 1 committed.
- **Ends with:** `research/ui-design.md`; new widgets in `core/src/ui/dom/widgets/`; new icons (part of A10, A14).
- **Owns:** `packages/core/src/ui/`, `packages/core/src/details/dom/tabStrip.ts` (only if it becomes the shared tab strip), `packages/core/src/library-ui/dom/list/emptyState.ts` (only if it moves), `documents/plans/spaces/research/ui-design.md`, their tests.

Runs with session 2 (disjoint Owns). Codebase facts: [research/codebase-core.md](../research/codebase-core.md). The mockup: `documents/ideas/spaces-mockup/` (build with `node build.mjs`, open `index.html`).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Design pass | task | main thread, `ui-design` skill | `research/ui-design.md` written | [ ] |
| 3.2 | Widgets | behaviour | implementer (sonnet) | widgets exist, typecheck passes | [ ] |
| 3.3 | Icons | task | main thread | icons render in both themes | [ ] |
| 3.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

3.2 and 3.3 run in parallel after 3.1.

## 3.1 — Design pass

- **Goal:** fix the DOM, classes, tokens and ARIA of every Spaces surface before code, in one file under 4,000 characters.
- **Read only:** the `ui-design` skill; the mockup screens (catalog, Overview, Papers, Notes, Discussions, Discover, Glossary, chat); `documents/product.md`; `packages/core/src/ui/dom/widgets/index.ts`; `packages/core/src/details/dom/tabStrip.ts`; `packages/core/src/library-ui/dom/list/emptyState.ts`.
- **Decided:** follow the mockup's layout. Write down, per surface: the widgets used; which existing core pieces are reused (paper row and `statusMark`, `arcMark`, tree rows, `quickPick`, `showDialog`, `toast`); the class prefix `ls-space-`; how a positioned control looks and reads (disabled, `aria-disabled`, tooltip naming what is missing); the empty-state copy for each block; keyboard and roles for the inner tabs (`tablist`) and the timeline (`list`). Product vocabulary: Space, paper, folder, Unread / Reading / Done.
- **Done when:** `research/ui-design.md` exists with a section per widget and per surface, and names the widgets 3.2 builds.

## 3.2 — Widgets

- **Goal:** the generic widgets `research/ui-design.md` names, in core.
- **Read only:** `research/ui-design.md`; `packages/core/src/ui/dom/dom.ts` (`el`); `packages/core/src/ui/dom/widgets/{index.ts,arcMark.ts,menu.ts}`; `packages/core/src/details/dom/tabStrip.ts`; `packages/core/src/ui/dom/tokens.css` (names only); AGENTS.md §2–§3.
- **Decided:** expected set (final list in `ui-design.md`): page tabs (inner tablist with arrow keys; generalise `details/dom/tabStrip.ts` if it fits, never a second strip), segmented filter with counts, progress mark (reuse `arcMark` if it fits), section card (title, actions slot, body), empty state (move `library-ui/dom/list/emptyState.ts` into `ui/dom/widgets/` if it is generic, and update its importers), member chip (initials), positioned-control helper (disables and sets the tooltip). Tokens only, no hard-coded values. One file per widget, plus CSS next to it; a subfolder if `widgets/` passes 8 files.
- **Done when:** jsdom tests only for behaviour (page tabs keyboard and `aria-selected`; filter selection event; positioned helper sets `disabled`, `aria-disabled` and `title`). `pnpm -r typecheck` passes.
- **Do not touch:** `spaces/`, apps.

## 3.3 — Icons

- **Goal:** add `share`, `calendar` and `users` to `packages/core/src/ui/icons/glyphs.ts`, drawn like the existing set (same grid and stroke).
- **Done when:** they render in light and dark in the mockup or any core page; an existing icon test, if any, covers them.

## 3.4 — Check, commit

`check` on Owns. Commit: `Add core widgets and icons for Spaces`.
