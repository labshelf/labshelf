# Session 4a — Webview check in headless Chromium

- **Wave:** 4, runs together with 4b
- **Starts from:** wave 3 committed
- **Ends with:** A1, A5–A8, A10, A14 (webview half) observed on fixture messages, light and dark, against the mockup; fixes committed
- **Owns:** fixes in `packages/core/src/reader/**` and `packages/core/src/ui/**`; `.verify/preview-4a/`
- **Research:** research/mockup.html, research/ui-kit.md
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. A bug whose fix is in `packages/vscode/` goes to 4b.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4a.1 | Headless check: header with every slot, footer cites/limit/checks, popover, marks, F8 step, citation card per fix kind; widths 1100 and 480; light and dark | — | `verify` (webview harness: a static server for the reader webview with the VS Code theme vars, driven by the Playwright headless shell in `~/Library/Caches/ms-playwright/chromium_headless_shell-*` with its own `--user-data-dir`; memory "Headless webview check") | screenshots in `.verify/preview-4a/`, findings listed | [ ] |
| 4a.2 | Fix what 4a.1 finds, one package per bug, test first | behaviour | implementer (sonnet; opus on a second failure) | re-shot screenshots fine | [ ] |
| 4a.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 4a.1 — What to look at

- Fixtures: `previewRoots` with options (latex and typst), `includeOnly`, `pdfProblems` placed and unplaced, `cites`, `words`, `pageLimit`/`wordLimit` near and over, `checks`; `buildStatus` current / stale / building; `citation` entries with each `fix`.
- Check: no horizontal overflow at 480 px; header ≤ 38 px, footer ≤ 26 px; every colour from `--ls-*` (stale dot and error colours visible: the 1a harness stubbed no `--vscode-editorWarning`/`Error` vars); focus rings; Escape closes menus and popovers.
