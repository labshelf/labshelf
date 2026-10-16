sha: be8baf12 (+ uncommitted 1a split and 1b protocol)
files: packages/core/src/reader/dom/preview/**, packages/core/src/reader/dom/chrome/*, packages/core/src/reader/dom/startup/*, packages/core/src/reader/dom/sidebar/outlineTab.ts, packages/core/src/reader/protocol.ts, packages/core/src/reader/previewProtocol.ts, packages/core/src/reader/previewRequests.ts, packages/core/src/reader/shell.ts
source: Explore scout, 2026-10-16 (refresh, webview side)

# Current preview (webview)

- **Composition:** `mountPreviewChrome({actions, banner, post, logs, visiblePoint, countBodyPages})` → `{applyRoots, applyBuild(state, errors), documentChanged}`; mounted in `startup/buildReaderUi.ts:66-76`. Host messages: `startup/hostMessages.ts:39` (reload → `showReloadError`, `documentChanged`), `:42` buildStatus → `applyBuild(msg.state, msg.errors)` (ignores 1b's `stale?`/`builtAt?` epoch ms), `:43` previewRoots → `applyRoots`.
- **Test pattern:** `__tests__/reader/dom/preview/mountPreviewChrome.test.ts` — `@jest-environment jsdom`; fixtures `root()`, `errors(n)`, `roots(shown, focused, list)`; `setup()` writes `#build-banner` into body, appends hidden `actions`, `post`/`logs` as `jest.fn()`; buttons indexed positionally.
- **Shell:** `reader/shell.ts` `READER_SHELL_BODY`: `main#pdf-shell` > `#toolbar`, `#find-bar`, `#viewerContainer > #viewer`, `#status-pill`, `#build-banner`, `#loading-msg`, `#error-msg`. Shared by both hosts; browser reader runs `preview: false`.
- **StatusPill** (`chrome/statusPill.ts`): fills `#status-pill` (page input, `/ N`, sep, zoom −, zoom label menu, zoom +); listens to `pagechanging`, `scalechanging`, DOCUMENT_REPLACED. Absolute over the viewer (reader.css:90-99). Only needs the element to exist, so it can be moved.
- **Toolbar** (`chrome/toolbar.ts`): overlay, autohide; `actions` slot; `setSidebarOpen`, `setFindOpen`, `setHistoryState`. Keys live in `navigation/keyboard.ts`.
- **FindBar:** `isOpen`, `onToggle(fn)`, `show()`, a close method; no `toggle()`. **Sidebar:** `onChange`, `isOpen`, `toggle()`. **ThemeController** (`chrome/theme.ts`): does not switch itself; UI posts `{command:"selectTheme", theme}`, host answers `applyTheme {theme, effectiveTheme}` handled at `dom/reader.ts:56`; `effective` field public.
- **Outline:** `logic/presentation/outlineModel.ts` (`flattenOutline`, `activeOutlineIndex(rowPages, page)`, rows with `parentId`). Destination → page resolution is private in `OutlineTab.resolvePages` and runs only when the tab is first shown; jump via `ctx.linkService.goToDestination(row.dest)`.
- **BuildBanner:** `showBusy`/`showFailed` used only by `PreviewNotice`; `showReloadError` used by hostMessages.ts:39.
- **Menus:** reader uses `elements` `buildMenu(items{label,hint?,checked?,separatorBefore?,run})` + `togglePopover(anchor, content, "below"|"above")` (statusPill zoom menu is the pattern). `ui/dom/widgets/menu.ts` `showMenu` is the library one.
- **Breadcrumb markup:** `library-ui/dom/header/breadcrumb.ts` separator `el("span",{class:"crumb-sep", html: icon("chevron-right")})`; not importable (library-ui context).
- **Time:** `library/format/elapsedTime.ts:14` `relativeTime(iso, now)` ("5m ago"), only formatter in core.
- **CSS:** `styles/preview.css` 66 lines, `reader.css` 300 (full). Core exports each CSS file explicitly (`core/package.json`), vscode imports them in `src/reader/main.ts`; esbuild inlines `@import`, so new files hang off `preview.css`.
- **1b protocol (in tree):** `buildStatus {state, errors, stale?, builtAt?}`; `previewRequests.ts` `{command:"runCommand", id: "compareVersions"|"markVersion"|"checkBeforeSubmitting"}`.
