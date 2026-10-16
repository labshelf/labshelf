# Session 3b — Webview wiring: slots, marks, keys

- **Goal:** The preview composition mounts every wave-2 piece, and the preview keys run.
- **Starts from:** sessions 2g, 2h and 2j committed
- **Ends with:** **A4** Ctrl/Cmd+S in the preview recompiles; double-click opens the source line (LaTeX). **A7** F8 / Shift+F8 and the arrows cycle problems, scroll to them and flash them. The limit meter replaces `PageChip`; logs, options, only, export, cites, limit and checks pieces and the marks overlay are mounted.
- **Owns:** under `packages/core/src/reader/dom/`: `preview/mountPreviewChrome.ts`, `preview/index.ts`, `preview/header/index.ts`, `preview/footer/index.ts`, `preview/footer/pageChip.ts` (delete), `styles/preview.css`, `startup/{readerActions,buildReaderUi,hostMessages}.ts`, `chrome/cheatsheet.ts`; their tests under `packages/core/__tests__/reader/dom/`
- **Research:** `research/preview.md`

Context: the wave-2 pieces exist as separate folders; this session only mounts them. Seam S3 (header pieces): `mount<X>(slot, { post })` → `{ setRoots(roots: PreviewRoots) }` for `header/{logs,options,only,export}`. Seam S4 (footer and marks): `mountProblemMarks`, `mountProblems` (with `step(±1)`), `mountLimitMeter` (with `documentChanged()`), `mountChecksButton`; exact signatures are in each folder's `index.ts`. A mismatch goes back to the caller, not into the piece's files. A slot stays hidden until its piece shows content (`.rd-preview-slot[hidden]` in `preview-header.css`). Another plan (writing-2-submission-tools, typst-source-sync) may touch preview messages: run `git worktree list` first.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3b.1 | Delete `footer/pageChip.ts` and its test after the swap; `@import` the wave-2 CSS files in `preview.css`; barrels export the wave-2 mounts | task | main thread | `grep -rn PageChip packages` empty | [ ] |
| 3b.2 | Composition mounts slots and marks | behaviour | implementer (sonnet); no new layout tests | existing core `reader` tests pass | [ ] |
| 3b.3 | Preview keys and cheatsheet | behaviour | implementer (sonnet); one test that the preview actions are gated by `KeyContext.preview` | tests pass | [ ] |
| 3b.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3b.1 — Tasks

- `@import` from `styles/preview.css`: `preview-logs-button.css`, `preview-options.css`, `preview-marks.css`, `preview-limit.css`, plus any other `preview-*.css` the wave-2 sessions added in `styles/` (list the directory). Export the wave-2 mounts from `header/index.ts`, `footer/index.ts` and `preview/index.ts`.

## 3b.2 — Composition

- **Goal:** `mountPreviewChrome` mounts options, only, logs, export (header) and cites, limit, checks (footer) and the marks overlay, and fans `applyRoots`/`documentChanged` out to them.
- **Read only:** `preview/mountPreviewChrome.ts:1-70`; `startup/buildReaderUi.ts:55-87`; `startup/hostMessages.ts:1-48`; `packages/core/__tests__/reader/dom/preview/mountPreviewChrome.test.ts` (setup and fixtures).
- **Decided:** each mount gets its slot from `header.slots`/`footer.slots`; marks mount on `#viewerContainer` with the reader's `pdfViewer` (add it to `PreviewChromeDeps`); `PreviewChrome` gains `problems: PreviewProblems` for the keys. `mountLimitMeter` goes in `footer.slots.limit` and `mountChecksButton` in `footer.slots.checks`; call the meter's `documentChanged()` where `PageChip.documentChanged` is called. `scrollTo(area)` uses the reader's page scrolling. `mountLogsButton(header.slots.logs, …)`.
- **Done when:** the existing composition test is updated for the new mounts and passes; `pnpm --filter @labshelf/core test` on `reader` passes.

## 3b.3 — Keys (A4, A7)

- **Goal:** the preview-only actions run.
- **Read only:** `startup/readerActions.ts:1-62`; `logic/navigation/keyBindings.ts:75-90`; `chrome/cheatsheet.ts:1-59`.
- **Decided:** `recompile` → `post({ command: "recompile" })`; `nextProblem`/`prevProblem` → `ui.previewChrome?.problems.step(±1)`; outside preview they do nothing. The keyboard passes `KeyContext.preview` from `ctx.boot.preview`; the cheatsheet lists the Preview group only in preview mode. Ctrl/Cmd+S prevents the browser save.
- **Done when:** the gating test passes; `pnpm --filter @labshelf/core test` on `reader` passes.
- **Do not touch:** the wave-2 folders (`header/{logs,options,only,export}`, `footer/{cites,limit,checks}`, `marks`, `hover/`).
