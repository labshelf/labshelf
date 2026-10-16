# Session 4a — Webview check in headless Chromium

- **Goal:** Observe the preview chrome in a headless browser against the mockup and fix what is wrong.
- **Starts from:** sessions 3a and 3b committed
- **Ends with:** these criteria (webview half) observed on fixture messages, light and dark, and fixes committed. **A1** The preview shows header (Recompile, options, logs, export | compare, mark, dark, find, sidebar, page nav, zoom), the desk and the footer at chrome height ≤ 38px header / 26px footer; no `--ls-*`-less colour in new CSS. **A5** Logs button shows the warning+error count; its menu lists entries and opens the source line or the raw log. **A6** Footer breadcrumb shows file › section › subsection; its menu jumps to a section. **A7** Footer shows `N cites · M to fix`; F8 / Shift+F8 and the arrows cycle problems, scroll to them and flash them; undefined cites have a red wavy underline, preprint entries amber, overfull lines a margin mark. **A8** Citation card shows authors · year, REF/BIB, title, venue · folder, `file:line · \cite…`, highlights on the cited page first then the rest folded, Open at p. N / Go to source. **A10** Limit meter and popover read and write the limits. **A14** Every theme renders the chrome readably; the sheet stays brand.
- **Owns:** fixes in `packages/core/src/reader/**` and `packages/core/src/ui/**`; `.verify/preview-4a/`
- **Research:** `documents/plans/pdf-preview-chrome/research/mockup.html`, `research/ui-kit.md`

Context: a bug whose fix is in `packages/vscode/` is reported, not fixed (4b owns it). Harness: a static server for the reader webview with the VS Code theme variables, driven by the Playwright headless shell in `~/Library/Caches/ms-playwright/chromium_headless_shell-*` with its own `--user-data-dir` (Chrome.app fails headless). Use the `verify` skill.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4a.1 | Headless check (below) | — | `verify` (webview harness) | screenshots in `.verify/preview-4a/`, findings listed | [ ] |
| 4a.2 | Fix what 4a.1 finds, one package per bug; test first only for a logic bug | behaviour | implementer (sonnet; opus on a second failure) | re-shot screenshots fine | [ ] |
| 4a.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 4a.1 — What to look at

- Fixtures: `previewRoots` with options (latex and typst), `includeOnly`, `pdfProblems` placed and unplaced, `cites`, `words`, `pageLimit`/`wordLimit` near and over, `checks`; `buildStatus` current / stale / building; `citation` entries with each `fix`. Widths 1100 and 480; light and dark.
- Check: no horizontal overflow at 480 px; header ≤ 38 px, footer ≤ 26 px; every colour from `--ls-*` (the stale dot, the logs badge fill `--ls-error`/`--ls-warning` on `--ls-reader-bg` text, and error colours visible: the 1a harness stubbed no `--vscode-editorWarning`/`--vscode-editorError` vars, so add them); focus rings; Escape closes menus and popovers.
