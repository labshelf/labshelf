sha: 18723264 (plus uncommitted work)
files: packages/core/src/library-ui/dom/shell/**, packages/core/src/library-ui/dom/detail/**, packages/core/src/library-ui/dom/header/listHeader.ts, packages/core/src/library-ui/dom/styles/**, packages/core/src/ui/**
source: Explore scout, 2026-10-17

# Library shell and detail pane: reuse seams

Paths relative to `packages/core/src/library-ui/dom/` unless noted.

## Shell

- `shell/frame.ts` (74): `buildFrame(host, prefs: PrefsPort, withSidebar: boolean): FrameSlots`, `showPane(root, prefs, "sidebar"|"detail")`, `togglePane(root, prefs, which): boolean`. `FrameSlots = {root, sidebar|null, header, list, citationMap, detail, dispose()}`. Library-specific: always builds `section.citation-map` and `aside.detail-pane` labelled "Paper details"; elements `.ls-library`, `.list-pane`, `.list-header`, `.list-body`. Collapse toggles `detail-collapsed` / `sidebar-collapsed` on root; widths inline. Limits `PANE_LIMITS`, double-click default `DEFAULT_PREFS.detailWidth` (frame.ts:24-33).
- `PrefsPort { load(): LibraryUiPrefs; save(patch) }` in `../state/prefs.ts:28`; pane keys `detailWidth, detailCollapsed, sidebarWidth, sidebarCollapsed`. Hosts: browser `library-page/prefs/localStoragePrefs.ts`, vscode `libraryWebview/webviewChannel.ts`.
- `shell/sash.ts` (48): `attachSash(sash, SashOptions)` is generic. No tests for frame or sash.
- Pane toggle button: `header/listHeader.ts:25` `<button class="ls-icon-btn" data-act="detail" title="Toggle details panel">${icon("panel-right")}</button>`, handler line 47 `togglePane(ctx.root, ctx.prefs, "detail")`.
- `icon(name)` from `packages/core/src/ui/icons/icon.ts`, names = keys of `ui/icons/glyphs.ts`; returns inline SVG; exported from `ui/dom`.

## Detail pane (paper-bound)

- `detail/detailPane.ts` (182): `mountDetailPane(ctx, container)`; rebuilds innerHTML on store change, keeps scroll/focus; delegated `data-action` clicks; section fold `toggleSection` (line 63) saves `prefs.secCollapsed`.
- `head/paperHead.ts` (75) builds `.detail-head`: `.head-more` (moreMenuButton), `.detail-title`, `.detail-byline`, `.detail-meta`, `.detail-toolbar` (primary `.ls-btn.ls-button-soft.open-btn`, cite menu), `.detail-status-row` (status menu + tag row). `head/tagRow.ts` `.tag-chip .tag-hash .tag-name`.
- `tabs/tabBar.ts` (25): `tabBarHtml(pane, v)` renders `.detail-tabs[role=tablist] > button.detail-tab(.active)[data-action=tab][data-tab]` with `.tab-badge`; labels fixed by `DetailTab`.
- GENERIC builders, not exported from `detail/index.ts`: `detail/detailMarkup.ts` (41): `section(id, title, body, collapsed, {count?})` -> `.detail-section > .sec-head[data-sec][role=button] (.sec-chevron .sec-title .sec-count) + .sec-body[data-sec-body]`; `kv(label, valueHtml)` (inside `.kv-grid`); `iconBtn(action, name, title, attrs)`, `copyBtn`, `muted(text)`, `loading(text)`.

## UI kit

- `ui/dom/widgets/menu.ts` `showMenu(anchor, entries, opts)`; also dialog, quickInput, toast. `el`, `$`, `highlight` in `ui/dom/dom.ts`.
- Buttons (`ui/dom/base.css:40-45`): `.ls-btn`, `.ls-btn-primary`, `.ls-button-soft`, `.ls-btn-ghost`, `.ls-icon-btn`.
- Times (`packages/core/src/library/format/elapsedTime.ts`): `relativeTime(iso, now?)` ("yesterday"), `compactTime(then: number, now?)` -> "now", "5 min", "3 h", "2 d", "2 w", "3 mo", "1 y".
- `formatLabel` (library-ui list) is the TEX/TYP label. `versionChipHtml` (`list/rowCells.ts:29`). No progress bar and no generic status dot exist.
- Tray: `TrayEntry` (`list/tray/fileFacts.ts:8`) = `{kind, name, type, tone, fact: {label, text, placeholder?} | null, title}`; `fact.label` is the role slot ("Main", "Bibliography").

## CSS

`styles/`: library-ui.css (frame, sash), library-list.css, library-detail.css (head, toolbar, tag chip), library-tabs.css (`.detail-tab`, `.sec-head`, `.kv-*`). One `package.json` export per stylesheet (`packages/core/package.json:41-59`). The VS Code All projects entry (`packages/vscode/src/writing/allProjects/webview/main.ts`) imports neither library-detail.css nor library-tabs.css.

## Tests

`packages/core/__tests__/library-ui/dom/`: `detail/{detailPane,detailHead}.test.ts`, `mountLibraryUi.test.ts`.
