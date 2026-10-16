sha: 8967fae7
files: packages/core/src/ui/**, packages/core/src/reader/dom/chrome/*, packages/core/src/reader/dom/hover/**
source: Explore scout, 2026-10-16 (refresh for 2f)

# UI pieces

- Tokens: `ui/tokens/{colorTokens,scaleTokens,readerThemeTokens,highlightTokens,vscodeHostMap}.ts` → `ui/dom/tokens.css` via `pnpm --filter @labshelf/core tokens` (never hand-edit). space-1 2px, 2 4px, 3 6px, 4 8px, 5 10px, 6 12px, 7 16px; `text-md` 12px. `--ls-row-selected` = focus 15%; `toolbar-hover` rgba(90,93,94,.31) dark / rgba(184,184,184,.31) light.
- Reader theme tokens (`readerThemeTokens.ts`, per PDF theme): reader-hover dark rgba(255,255,255,.09) / light rgba(0,0,0,.07); reader-active .15 / .12; reader-border #3c3c3c / #d4d4d4; reader-page #1e1e1e / #fff. `renderReaderThemesCss` (:85) hard-codes `--ls-reader-toolbar-h: 38px` and `--ls-reader-footer-h: 26px`.
- Base CSS (`ui/dom/base.css`): `.ls-btn`, `.ls-btn-primary`, `.ls-icon-btn`, `.ls-input`, `.ls-chip`, `.ls-button-soft`, `.ls-checkbox`. No breadcrumb or segmented-control widget.
- Widgets (`ui/dom/widgets/`: menu, toast, overlay, dialog, quickInput, arcMark): `showMenu(anchor: {x,y} | HTMLElement, entries: (MenuItem | "separator")[], opts {root?, onClose?})`; `closeMenu()`. `MenuItem {label, icon?, lead?, checked?, hint?, danger?, disabled?, onSelect}`; no submenus. `toast(message, kind)`; error toasts get `role="alert"`.
- Reader elements: `reader/dom/elements` `buildMenu`, `togglePopover`, `iconButton`. `reader/dom/chrome/` exports BuildBanner (only "PDF could not reload"), Cheatsheet, SelectionBubble, StatusPill, TabList, ThemeController (`onEffectiveChange`), openThemePopover, Toolbar (no actions group).
- Citation card (`reader/dom/hover/citations/`, 8 files, all ≤ 65 lines): `citationCard.ts` exports `OPEN_PAPER_LABEL` (:9), `citationContent(entries, open): PopupContent | null` (:49); `citationTabs.ts` exports `citationTabs(paper)` (:48); `previewCitations.ts` exports `class PreviewCitations` (:13); `index.ts` exports `interceptCitationClicks`, `PreviewCitations`. `hover/popup.ts` exports `textContent`, `class HoverPopup`.
- Citation CSS: `.rd-hover-cite(s)`, `.rd-cite-{byline,missing,summary,key,row,title}` in `reader/dom/styles/reader.css:214-229` (file is 290 lines). Preview-card rules (`.rd-cite-head`, `-head-text`, `-tabs` + `.rd-tab` overrides, `-panel`, `-list`, `-highlight`, `-quote`, `-page`, `-empty`) in `reader/dom/styles/preview.css:45-62`.
- Icons (`ui/icons/glyphs.ts`, `STROKE_GLYPHS`, Lucide 24×24): refresh, loader, panel-left, search, droplet, sun, moon, download, external, gear, list, warning, help, arrow-left/right/up, git-compare, contrast, upload, log. No `arrow-down`.
- Docs: `documents/apps/vscode.md:42-58` (preview toolbar); `.claude/skills/ui-design/SKILL.md`.
