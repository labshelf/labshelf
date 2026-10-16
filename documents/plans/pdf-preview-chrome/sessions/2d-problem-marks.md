# Session 2d — Webview: problem marks, cites count, F8 cycle

- **Wave:** 2, runs together with 2a–2c, 2e–2i
- **Starts from:** wave 1 committed
- **Ends with:** A7 from `PdfProblem` fixtures: wavy underlines, overfull margin mark, footer `N cites · M to fix`, arrows and a `step` the keys call (keys wired by 3b)
- **Owns:** `packages/core/src/reader/dom/preview/marks/` (new), `packages/core/src/reader/dom/preview/footer/cites/` (new), `packages/core/src/reader/dom/styles/preview-marks.css` (new), their tests
- **Research:** research/ui-kit.md, research/mockup.html
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2d.1 | Marks overlay on the pages | behaviour | implementer (sonnet) | jsdom tests pass | [ ] |
| 2d.2 | Footer cites status, arrows, `step`, flash, toast | behaviour | implementer (sonnet) | jsdom tests pass | [ ] |
| 2d.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2d.1 — Marks overlay

- **Goal:** each placed `PdfProblem` gets a mark over its `area` on its page that survives zoom and page re-render.
- **Read only:** `core/src/reader/previewProtocol.ts:11-25` (`PagePoint`, `PageArea`), `:82-101`; `core/src/reader/dom/hover/citations/pageAreas.ts:1-26` (PDF area → page pixels); `core/src/reader/dom/hover/citations/linkAnnotations.ts:1-32` (per-page layer pattern); `research/mockup.html:93-98` (`.cit`, `.ovf`).
- **Decided:** `marks/problemMarks.ts`: `mountProblemMarks(deps: { container: HTMLElement; pdfViewer: PdfViewerLike }): ProblemMarks` with `setProblems(p: readonly PdfProblem[]): void`, `flash(index: number): void`. Layer `div.rd-problem-marks` per page view, re-drawn on `pagerendered` and `scalechanging`. Classes: `undefinedCitation`/`undefinedReference` red wavy underline (`--ls-error`), `preprint` amber (`--ls-warning`), `overfull` a margin bar right of the area. `aria-hidden="true"` (the footer is the accessible path). Reduced motion: flash without animation.
- **Done when:** jsdom test with a stub viewer pins one mark per placed problem and none for unplaced; core `reader` tests pass.

## 2d.2 — Cites status and cycling (A7)

- **Goal:** the footer shows `N cites · M to fix` with prev/next arrows; stepping scrolls to the problem and flashes it.
- **Read only:** `core/src/reader/dom/preview/footer/previewFooter.ts:1-127` (slot and status markup); `core/src/reader/previewProtocol.ts:111-140` (`PreviewRoot.cites`, `pdfProblems`); `core/src/ui/dom/widgets/toast.ts` (signature); `research/mockup.html:336` (`goProb`).
- **Decided:** `footer/cites/citesStatus.ts`: `mountProblems(slot, deps: { marks: ProblemMarks; scrollTo(area: PageArea): void; post }): PreviewProblems` with `setRoots(roots)` (reads the shown root) and `step(dir: 1 | -1): void`. `M` counts `pdfProblems`; text "1 cite" singular, "· M to fix" only when M > 0. Step wraps; placed → `scrollTo` + `marks.flash`; unplaced → toast with the message and `post({command:"openSourceLine", file, line})` when it has a place; empty → toast "No problems in the PDF". `marks/index.ts` and `footer/cites/index.ts` export the two mounts.
- **Seams:** provides S4.
- **Done when:** jsdom tests: text, wrap, unplaced toast + post; core `reader` tests pass.
- **Do not touch:** `footer/previewFooter.ts`, `footer/index.ts`, `mountPreviewChrome.ts`, `startup/**`, `styles/preview.css`.
