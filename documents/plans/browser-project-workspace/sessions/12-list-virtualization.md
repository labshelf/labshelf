# Session 12 — virtualized paper list and All projects treegrid

- **Goal:** the paper list and the All projects treegrid render only the rows in view, with the same grouping, keyboard, selection and accessibility.
- **Starts from:** session 9 committed.
- **Ends with:** 2,000 papers and 50 projects scroll without long tasks; behaviour unchanged.
- **Owns:** `packages/core/src/library-ui/dom/list/`, `packages/core/src/writing/allProjects/dom/`, their tests.

Runs with sessions 10 and 11. Neither list virtualizes today (no windowing, visible range, row height or IntersectionObserver in either folder).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 12.1 | Row window in core | behaviour | implementer (opus), tests first | window tests pass | [ ] |
| 12.2 | Both lists on the window | behaviour | implementer (sonnet) | jsdom tests and a headless scroll pass | [ ] |
| 12.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 12.1 — Row window

- **Read only:** `packages/core/src/library-ui/dom/list/` index and its row renderer; `packages/core/src/writing/allProjects/dom/mountAllProjects.ts`; the core list tests under `packages/core/__tests__/library-ui/dom/list/`.
- **Decided:** one core module `dom/list/rowWindow.ts` computes the visible slice from a flat row model (folder headers are rows of their own) with a fixed row height from a core token, 10 rows of overscan, and spacer heights above and below; a collapsed folder removes its rows from the model. It is runtime DOM-only and has no knowledge of papers or projects.
- **Done when:** tests pin slices at top, middle, end, after collapse and after a resize.

## 12.2 — Both lists

- **Read only:** 12.1's module; the list and treegrid renderers above; their keyboard handlers.
- **Decided:** focus and selection live in the model, not in DOM rows, so Arrow/Home/End/PageUp/PageDown and Shift-range selection reach rows outside the window, scrolling them into view before focusing; the container keeps `role="grid"`/`treegrid`, `aria-rowcount` is the model length and each rendered row carries its `aria-rowindex` (and `aria-level`, `aria-expanded` for folders). Column headers and dividers stay.
- **Done when:** jsdom tests pin keyboard moves across the window edge and aria attributes; a headless run scrolls 2,000 rows with no task over 50 ms.
