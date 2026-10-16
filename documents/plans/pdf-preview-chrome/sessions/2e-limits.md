# Session 2e — Limits and checks: counts, meter, popover, checks button

- **Wave:** 2, runs together with 2a–2d, 2f–2i
- **Starts from:** wave 1 committed
- **Ends with:** A10 (meter and popover read and write `check.*`; words across `\include`/`\input`), A11 button, fixture-driven; host functions wired by 3a
- **Owns:** `packages/core/src/writing/checks/limits/` (new), `packages/core/src/writing/checks/index.ts`, `packages/vscode/src/writing/preview/limits/` (new), `packages/vscode/src/writing/check/node/registerCheckCommand.ts`, `packages/core/src/reader/dom/preview/footer/limit/` (new), `packages/core/src/reader/dom/preview/footer/checks/` (new), `packages/core/src/reader/dom/styles/preview-limit.css` (new), their tests
- **Research:** research/writing-core.md, research/mockup.html
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. `footer/pageChip.ts` stays until 3b swaps in the meter and deletes it.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2e.1 | Core `wordsUpTo`; host `rootWords`, `setCheckLimits`, last check count | behaviour | implementer (sonnet) | tests pass | [ ] |
| 2e.2 | Footer limit meter, popover and checks button | behaviour | implementer (sonnet) | jsdom tests pass | [ ] |
| 2e.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2e.1 — Counts and limits (D3)

- **Goal:** the host knows a root's words up to `countUpTo`, writes limit changes to labshelf.yaml, and remembers the last check's finding count.
- **Read only:** `core/src/writing/latex/source/words/countWords.ts:1-41`; `core/src/writing/checks/paperBody.ts:1-45`; `core/src/writing/latex/source/project/collectProjectSources.ts` (signature); `core/src/writing/project/projectFile.ts` (grep `CheckLimits`, 1b's patch); `core/src/reader/previewRequests.ts:13-19`; `vscode/src/writing/check/node/registerCheckCommand.ts:25-67`.
- **Decided:** core `checks/limits/wordsUpTo.ts`: `wordsUpTo(sources: readonly { text: string }[] in include order, countUpTo: CountUpTo): number` — stops at `\bibliography`/`\printbibliography`/`#bibliography` for `references`, at `\end{document}` for `end`; reuse `countWords`. Host `preview/limits/`: `rootWords(deps, project, root): Promise<number>` (collect sources, then `wordsUpTo`); `setCheckLimits(deps, project, change: CheckLimitsChange)` through `ProjectDataPort.updateProjectSettings`; `CheckCounts` with `record(folder, n)`, `get(folder)`, `onChange(fn)`; `registerCheckCommand.ts` takes an optional `onFindings(folder, n)` dep and calls it after `runCheck`.
- **Seams:** provides S6.
- **Done when:** core tests for both `countUpTo` values and an `\input` chain; host tests with fakes; core `writing/checks` and vscode `writing/check`, `writing/preview` tests pass.
- **Do not touch:** `preview/roots/**`, `previewPorts.ts`, `writing/project/**`.

## 2e.2 — Meter, popover, checks button (A10, A11)

- **Goal:** the footer shows pages (and words when a word limit is set) with a 42 px meter, a popover to edit limits, and an `N checks` button.
- **Read only:** `core/src/reader/dom/preview/footer/pageChip.ts:1-77` (body-page counting and `bodyPages` post to keep); `core/src/reader/previewProtocol.ts:111-140` (`pageLimit`, `wordLimit`, `countUpTo`, `checks`, `PreviewRoot.words`); `core/src/reader/previewRequests.ts:1-50`; `research/mockup.html:119-122` (`.meter`), `:167-175` (`.lim`), `:322` (`openLim`).
- **Decided:** `footer/limit/limitMeter.ts`: `mountLimitMeter(slot, { post; countBodyPages(): Promise<number> }): { setRoots(roots); documentChanged(): void }` — same counting and `bodyPages` post as `PageChip`; meter `near` ≥ 90 %, `over` > 100 %, colours `--ls-warning` / `--ls-error`; text `p. N / L` and `W words / L`. Popover (`togglePopover(..., "above")`): page limit and word limit number inputs (empty = remove → `null`), segmented `References | End` (`aria-checked`), Enter or blur posts `{command:"setCheckLimits", limits}` with changed fields only; validate positive integers. `footer/checks/checksButton.ts`: `mountChecksButton(slot, { post }): { setRoots(roots) }`, text `N checks` (hidden when `checks` absent) → `post({command:"runCommand", id:"checkBeforeSubmitting"})`. Keyboard: inputs labelled, Escape closes.
- **Seams:** provides S4 (limit, checks).
- **Done when:** jsdom tests: thresholds, null on empty, only changed fields, checks post; core `reader` tests pass.
- **Do not touch:** `footer/pageChip.ts`, `footer/index.ts`, `footer/previewFooter.ts`, `mountPreviewChrome.ts`, `styles/preview.css`.
