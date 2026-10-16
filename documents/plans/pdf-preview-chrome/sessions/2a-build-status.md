# Session 2a — Build status: stale state and logs button

- **Wave:** 2, runs together with 2b–2i
- **Starts from:** wave 1 committed
- **Ends with:** host sends `stale`/`builtAt` (A2 host half); header logs button with count and menu (A5), fixture-driven; A2/A5 observed in wave 4
- **Owns:** `packages/core/src/reader/host/hostController.ts`, `packages/vscode/src/writing/preview/projectPreview/**`, `packages/vscode/src/writing/preview/stale/` (new), `packages/core/src/reader/dom/preview/header/logs/` (new), `packages/core/src/reader/dom/styles/preview-logs-button.css` (new), their tests
- **Research:** research/preview.md
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages. What is left becomes a new session file.

Wave rules: plan.md §6. The webview already renders stale and builtAt (`footer/buildStatusText.ts`, header `setBuild`); this session feeds it. Wiring the logs button into the composition is 3b's.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2a.1 | Stale tracking and `setBuildStatus` extension | behaviour | implementer (sonnet) | host tests pass | [ ] |
| 2a.2 | Header logs button with count and menu | behaviour | implementer (sonnet) | jsdom tests pass | [ ] |
| 2a.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2a.1 — Stale tracking (D7)

- **Goal:** a project source saved or edited after the last successful build of the shown root marks it stale; a success sends `builtAt`.
- **Read only:** `core/src/reader/host/hostController.ts:85-110`; `vscode/src/writing/preview/projectPreview/buildPreviews.ts:25-157`; `vscode/src/writing/latexEditing/project/latexProjectSources.ts:30-50` (how edits and saves are observed); `core/src/reader/protocol.ts:94-97`; `documents/contracts/reader-host.md` section Preview (grep `stale`).
- **Decided:** `setBuildStatus(state, errors = 0, extra: { stale?: boolean; builtAt?: number } = {})` posts the extra fields only when present. A tracker class in `preview/stale/staleSources.ts` keeps `builtAt` per project folder + root and a `stale` flag set by `onDidSaveTextDocument`/`onDidChangeTextDocument` of a file under the project folder after that time; a successful build clears it; a failed build keeps it. `buildPreviews.ts` calls the tracker and resends `buildStatus` on the first edit after a build (once, not per keystroke). Typst live compile clears stale on success like any build. Inject the vscode events (no `vscode` import in the tracker), so it unit-tests.
- **Seams:** provides `setBuildStatus` (plan §6 S1).
- **Done when:** tests for the tracker (edit after build → stale; build success → clear, builtAt set) and for the controller message; `pnpm --filter @labshelf/vscode test -- preview` and core `reader/host` pass; files ≤ 200 lines.
- **Do not touch:** `preview/roots/**`, `previewPorts.ts`, build listeners in `writing/build/` and `writing/typst/`.

## 2a.2 — Logs button (A5)

- **Goal:** a header button showing the shown root's warning + error count; its menu lists the entries and opens the source line or the raw log.
- **Read only:** `core/src/reader/dom/preview/header/previewHeader.ts:1-83`; `core/src/reader/dom/preview/logs/logsView.ts:1-80`, `logs/logEntries.ts:1-42`; `core/src/reader/previewProtocol.ts:82-140`; `core/src/reader/dom/chrome/statusPill.ts:1-101` (the `buildMenu` + `togglePopover` pattern); `research/mockup.html:193` and `:418-423` (logs button, `openMenu`).
- **Decided:** `mountLogsButton(slot: HTMLElement, deps: { post; openLogs(root: string): void }): { setRoots(roots: PreviewRoots): void }` in `header/logs/logsButton.ts` with its own `index.ts`. Icon `log`, badge with the count of `error`+`warning` problems of `roots.shown`, hidden at 0; menu items one per problem (message, `file:line` hint) → `post({command:"openProblem", root, index})`; a last item "Open raw log" when `rawLog` → `openRawLog`; "Show all" → `openLogs(root)`. Slot `hidden` false once mounted. CSS only `--ls-*` tokens.
- **Seams:** provides S3 (logs).
- **Done when:** `__tests__/reader/dom/preview/header/logs/logsButton.test.ts` (jsdom) pins count, hidden at 0, menu posts; core `reader` tests pass.
- **Do not touch:** `mountPreviewChrome.ts`, `header/index.ts`, `header/previewHeader.ts`, `styles/preview.css`.
