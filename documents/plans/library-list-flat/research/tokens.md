sha: 762949b
files: packages/core/src/ui/tokens/*.ts, packages/core/src/ui/dom/{tokens.css,vscodeHost.css,base.css,theme.ts}, packages/core/src/library-ui/dom/styles/*.css, packages/browser/src/{ui/themeBoot.ts,content/shadowStyles.ts,library-page/page.css}, packages/core/__tests__/ui/**
source: Explore scout, 2026-10-16

# Tokens and host mapping

## Layers
- Data in `packages/core/src/ui/tokens/`: colorTokens.ts (COLOR_TOKENS surface roles `token(dark, light?)`, STATUS_TOKENS, MARK_TOKENS), highlightTokens.ts, scaleTokens.ts (TYPE, SPACE 1..7, SHAPE radius/row-h, ELEVATION, MOTION), readerThemeTokens.ts, vscodeHostMap.ts.
- `pnpm --filter @labshelf/core tokens` writes tokens.css (:root dark + `:root[data-theme="light"]` overrides) and vscodeHost.css. Both generated; tokensCss.test.ts fails on drift.

## Host mapping
- VS Code: VSCODE_HOST_MAP → vscodeHost.css (`--ls-x: var(--vscode-*)`), imported by vscode libraryWebview/reader/templates `main.ts`. Unmapped tokens stay brand-fixed in VS Code.
- Browser: tokens.css values; light/dark via `<html data-theme>` (core ui/dom/theme.ts:15, browser ui/themeBoot.ts pre-paint). content/shadowStyles.ts:9 rewrites the light selector, so its shape must stay.

## Fit for the target
- zebra: missing. selection band: list-active-bg/-fg (mapped). open-paper tint: missing. keyboard focus: list-focus-outline/focus exist, list uses `:focus` not `:focus-visible`. muted labels: desc, text-xs/sm, section-fg. mono: `--ls-mono` (mapped to editor font). file-type colours: missing. #tags: mono + link. soft tinted primary button: missing (button-* are solid, mapped; color-mix unused in core css). hairlines: border, border-soft, border-faint, section-border. status: status-unread/-reading/-done (reading/done mapped to charts colours), MARK_TOKENS (brand, unmapped) — arc marks should use MARK_TOKENS.
- No serif token in UI tokens.

## Missing tokens
zebra bg, open-paper tint, file-type colours (pdf, md, ref, attachment), soft-button bg/fg/hover.

## Risks
- tokenContrast.test.ts requires opaque #rrggbb for listed text pairs (4.5:1); new text tokens (file-type labels) need hex + PAIRS entry. Tinted rgba backgrounds cannot be checked there.
- Surface tokens (zebra, tint, soft button) must be added to VSCODE_HOST_MAP to follow the VS Code theme; file-type colours stay brand (unmapped), like marks.
- Browser tree CSS is browser-side: packages/browser/src/library-page/page.css:34-62.
- Working-tree diff in scaleTokens.ts adds only gallery tokens (unrelated).
