sha: be8baf12 (+ uncommitted library-list-flat 2a changes in ui/)
files: packages/core/src/ui/**, packages/core/src/reader/dom/chrome/*, packages/core/src/reader/dom/hover/**
source: Explore scout, 2026-10-16 (refresh)

# UI pieces

- Tokens: `ui/tokens/{colorTokens,scaleTokens,readerThemeTokens,highlightTokens,vscodeHostMap}.ts` → `ui/dom/tokens.css` via `pnpm --filter @labshelf/core tokens` (never hand-edit). Scale entries look like `"space-4": token("8px"),`; space-1 2px … space-7 16px; `text-md` 12px.
- Reader theme tokens (`readerThemeTokens.ts`, fixed per PDF theme, not the VS Code theme): reader-hover dark rgba(255,255,255,.09) / light rgba(0,0,0,.07); reader-active .15 / .12; reader-border #3c3c3c / #d4d4d4; reader-page #1e1e1e / #fff. `--ls-reader-toolbar-h: 38px` is hard-coded in `renderReaderThemesCss`.
- Base CSS (`ui/dom/base.css`): `.ls-btn`, `.ls-btn-primary`, `.ls-icon-btn` (`[aria-pressed=true]`, `.active`), `.ls-input`, `.ls-chip`, `.ls-button-soft`. No breadcrumb or segmented control widget exists.
- Widgets: `showMenu(anchor: {x,y} | HTMLElement, entries: (MenuItem | "separator")[], opts?: {root?, onClose?})`; `MenuItem {label, icon?, lead?, checked?, hint?, danger?, disabled?, onSelect}`; checked items → `menuitemcheckbox`; no submenus; flips on overflow. `toast(message, kind)`; `overlay.ts` `mountOverlay`; `dialog.ts`, `quickInput.ts`, `arcMark.ts`.
- Reader elements: `reader/dom/elements` `buildMenu`, `togglePopover`, `iconButton`; `chrome/themePopover.ts`, `statusPill.ts`, `buildBanner.ts`.
- Card: `reader/dom/hover/citations/citationCard.ts`, `citationTabs.ts`, `hover/popup.ts`.
- Icons (`ui/icons/glyphs.ts`, `STROKE_GLYPHS` name → Lucide 24×24 body, e.g. `check: '<path d="M20 6 9 17l-5-5"/>'`): includes refresh, loader, panel-left, search, droplet, sun, moon, download, external, gear, list, warning, help, arrow-left/right/up. Missing: git-compare, contrast, upload, log.
- Docs: `documents/apps/vscode.md:42-58` describes the preview toolbar; `.claude/skills/ui-design/SKILL.md`.
