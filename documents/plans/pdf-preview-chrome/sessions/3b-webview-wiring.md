# Session 3b — Webview wiring: slots, marks, keys

- **Wave:** 3, runs together with 3a
- **Starts from:** wave 2 committed
- **Ends with:** the composition mounts every wave-2 piece; Ctrl/Cmd+S recompiles, F8 / Shift+F8 cycle problems (A4, A7); the limit meter replaces `PageChip`
- **Owns:** `packages/core/src/reader/dom/preview/mountPreviewChrome.ts`, `preview/index.ts`, `preview/header/index.ts`, `preview/footer/index.ts`, `preview/footer/pageChip.ts` (delete), `packages/core/src/reader/dom/styles/preview.css`, `packages/core/src/reader/dom/startup/{readerActions,buildReaderUi,hostMessages}.ts`, `packages/core/src/reader/dom/chrome/cheatsheet.ts`, their tests (paths under `packages/core/src/reader/dom/`)
- **Research:** research/preview.md
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3b.1 | Tasks: delete `footer/pageChip.ts` and its test after the swap; `@import` the wave-2 CSS files (`preview-logs-button`, `preview-options`, `preview-marks`, `preview-limit`) in `preview.css`; barrels export the wave-2 mounts | task | main thread | `grep -rn PageChip packages` empty, gate | [ ] |
| 3b.2 | Composition mounts slots and marks | behaviour | implementer (sonnet) | jsdom tests pass | [ ] |
| 3b.3 | Preview keys and cheatsheet | behaviour | implementer (sonnet) | jsdom tests pass | [ ] |
| 3b.4 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 3b.2 — Composition

- **Goal:** `mountPreviewChrome` mounts options, only, logs, export (header) and cites, limit, checks (footer) and the marks overlay, and fans `applyRoots`/`documentChanged` out to them.
- **Read only:** `preview/mountPreviewChrome.ts:1-70`; `startup/buildReaderUi.ts:55-87`; `startup/hostMessages.ts:1-48`; `__tests__/reader/dom/preview/mountPreviewChrome.test.ts` (setup and fixtures); plan §6 Seams S3, S4.
- **Decided:** each mount gets its slot from `header.slots`/`footer.slots`; marks mount on `#viewerContainer` with the reader's `pdfViewer` (add it to `PreviewChromeDeps`); `PreviewChrome` gains `problems: PreviewProblems` for the keys. A slot stays hidden until its piece shows content. `scrollTo(area)` uses the reader's page scrolling.
- **Done when:** composition test asserts each slot mounted and `applyRoots` reaches all pieces; core `reader` tests pass.

## 3b.3 — Keys (A4, A7)

- **Goal:** the preview-only actions run.
- **Read only:** `startup/readerActions.ts:1-62`; `logic/navigation/keyBindings.ts:75-90`; `chrome/cheatsheet.ts:1-59`; log.md line "1b handoff for 1a/2b".
- **Decided:** `recompile` → `post({command:"recompile"})`; `nextProblem`/`prevProblem` → `ui.previewChrome?.problems.step(±1)`; outside preview they do nothing. The keyboard passes `KeyContext.preview` from `ctx.boot.preview`; the cheatsheet lists the Preview group only in preview mode. Ctrl/Cmd+S prevents the browser save.
- **Done when:** jsdom tests: each action, no-op outside preview, cheatsheet group; core `reader` tests pass.
- **Do not touch:** wave-2 folders (`header/{logs,options,only,export}`, `footer/{cites,limit,checks}`, `marks`, `hover/`).

**From 2e2:** import `styles/preview-limit.css`; mount `mountLimitMeter` in `footer.slots.limit` and `mountChecksButton` in `footer.slots.checks`; call the meter's `documentChanged()` where `PageChip.documentChanged` is called, then delete `footer/pageChip.ts`. The slots rely on `.rd-preview-slot[hidden]` in preview-header.css.
