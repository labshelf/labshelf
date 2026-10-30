/**
 * Renders the design tokens as the `--ls-*` stylesheet that `ui/dom/tokens.css` holds, and maps them to the host's VS Code theme in `ui/dom/vscodeHost.css`.
 */
import { CODE_FONT_TOKENS, COLOR_TOKENS, ELEVATION_TOKENS, FILE_TYPE_TOKENS, HIGHLIGHT_COLORS, MARK_TOKENS, MOTION_TOKENS, PLOT_TOKENS, SHAPE_TOKENS, SHEET_TOKENS, SPACE_TOKENS, STATUS_TOKENS, TYPE_TOKENS, createDesignToken, renderCodeFontsCss, type DesignToken } from "./tokens.js";
import { CODE_THEME_TOKENS, renderCodeThemesCss, renderReaderThemesCss } from "./themes.js";

const ALL_TOKENS: Record<string, DesignToken> = {
  ...COLOR_TOKENS,
  ...STATUS_TOKENS,
  ...MARK_TOKENS,
  ...FILE_TYPE_TOKENS,
  ...SHEET_TOKENS,
  ...PLOT_TOKENS,
  ...CODE_THEME_TOKENS,
  ...Object.fromEntries(Object.entries(HIGHLIGHT_COLORS).map(([name, value]) => [`hl-${name}`, createDesignToken(value)])),
  ...TYPE_TOKENS,
  ...CODE_FONT_TOKENS,
  ...SPACE_TOKENS,
  ...SHAPE_TOKENS,
  ...ELEVATION_TOKENS,
  ...MOTION_TOKENS,
};

// The browser sets <html data-theme> before first paint, and its content scripts
// rewrite these two selectors to :host, so their exact shape is part of the output.
export function renderTokensCss(tokens: Record<string, DesignToken> = ALL_TOKENS): string {
  const entries = Object.entries(tokens);
  const dark = entries.map(([name, t]) => `  --ls-${name}: ${t.value};`);
  const light = entries.flatMap(([name, t]) => (t.light === undefined ? [] : [`  --ls-${name}: ${t.light};`]));
  return [
    "/* Declares the --ls-* design tokens for both themes. Generated from packages/core/src/ui/tokens by `pnpm --filter @labshelf/core tokens`. Do not edit. */",
    ":root {",
    "  color-scheme: dark;",
    ...dark,
    "}",
    "",
    ':root[data-theme="light"] {',
    "  color-scheme: light;",
    ...light,
    "}",
    "",
  ].join("\n") + renderReaderThemesCss() + "\n" + renderCodeThemesCss() + renderCodeFontsCss();
}

type MappedToken = keyof typeof COLOR_TOKENS | keyof typeof STATUS_TOKENS | keyof typeof TYPE_TOKENS | keyof typeof ELEVATION_TOKENS;

// Roles VS Code has no variable for (overlay, the highlight palette, the
// type and spacing scale) keep their token value in VS Code too.
const VSCODE_HOST_MAP: Partial<Record<MappedToken, string>> = {
  "workspace-bg": "var(--vscode-editorGroup-emptyBackground, var(--vscode-sideBar-background))",
  bg: "var(--vscode-editor-background)",
  fg: "var(--vscode-foreground)",
  desc: "var(--vscode-descriptionForeground)",
  error: "var(--vscode-errorForeground)",
  link: "var(--vscode-textLink-foreground)",
  focus: "var(--vscode-focusBorder)",
  "editor-cursor": "var(--vscode-editorCursor-foreground)",
  "editor-selection-bg": "var(--vscode-editor-selectionBackground)",
  "editor-inactive-selection-bg": "var(--vscode-editor-inactiveSelectionBackground)",
  "sidebar-bg": "var(--vscode-sideBar-background, var(--vscode-editor-background))",
  "sidebar-border": "var(--vscode-sideBar-border, var(--vscode-panel-border))",
  "section-fg": "var(--vscode-sideBarSectionHeader-foreground)",
  "section-bg": "var(--vscode-sideBarSectionHeader-background)",
  "section-border": "var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border))",
  border: "var(--vscode-panel-border)",
  "border-soft": "var(--vscode-panel-border)",
  "border-faint": "var(--vscode-panel-border)",
  "widget-bg": "var(--vscode-editorWidget-background)",
  "code-bg": "var(--vscode-textCodeBlock-background)",
  "sash-hover": "var(--vscode-sash-hoverBorder)",
  progress: "var(--vscode-progressBar-background)",
  "list-hover": "var(--vscode-list-hoverBackground)",
  "list-active-bg": "var(--vscode-list-activeSelectionBackground)",
  "list-active-fg": "var(--vscode-list-activeSelectionForeground)",
  "list-inactive-bg": "var(--vscode-list-inactiveSelectionBackground)",
  "list-drop-bg": "var(--vscode-list-dropBackground)",
  "list-focus-outline": "var(--vscode-list-focusOutline)",
  "tree-guide": "var(--vscode-tree-indentGuidesStroke)",
  "menu-bg": "var(--vscode-menu-background)",
  "menu-fg": "var(--vscode-menu-foreground)",
  "menu-border": "var(--vscode-menu-border, var(--vscode-widget-border))",
  "menu-selection-bg": "var(--vscode-menu-selectionBackground)",
  "menu-selection-fg": "var(--vscode-menu-selectionForeground)",
  "menu-separator": "var(--vscode-menu-separatorBackground)",
  "button-bg": "var(--vscode-button-background)",
  "button-fg": "var(--vscode-button-foreground)",
  "button-hover": "var(--vscode-button-hoverBackground)",
  "button-soft-fg": "color-mix(in srgb, var(--vscode-textLink-foreground) 80%, var(--vscode-foreground))",
  "button2-bg": "var(--vscode-button-secondaryBackground)",
  "button2-fg": "var(--vscode-button-secondaryForeground)",
  "button2-hover": "var(--vscode-button-secondaryHoverBackground)",
  "input-bg": "var(--vscode-input-background)",
  "input-fg": "var(--vscode-input-foreground)",
  "input-border": "var(--vscode-input-border, transparent)",
  "input-placeholder": "var(--vscode-input-placeholderForeground)",
  "toolbar-hover": "var(--vscode-toolbar-hoverBackground)",
  "toolbar-active": "var(--vscode-toolbar-activeBackground)",
  "badge-bg": "var(--vscode-badge-background)",
  "badge-fg": "var(--vscode-badge-foreground)",
  "kbd-fg": "var(--vscode-keybindingLabel-foreground)",
  "kbd-bg": "var(--vscode-keybindingLabel-background)",
  "kbd-border": "var(--vscode-keybindingLabel-border)",
  "kbd-bottom": "var(--vscode-keybindingLabel-bottomBorder)",
  scrollbar: "var(--vscode-scrollbarSlider-background)",
  "scrollbar-hover": "var(--vscode-scrollbarSlider-hoverBackground)",
  "scrollbar-active": "var(--vscode-scrollbarSlider-activeBackground)",
  blue: "var(--vscode-charts-blue)",
  yellow: "var(--vscode-charts-yellow)",
  green: "var(--vscode-charts-green)",
  "find-match": "var(--vscode-editor-findMatchHighlightBackground)",
  warning: "var(--vscode-editorWarning-foreground)",
  "warning-bg": "var(--vscode-inputValidation-warningBackground)",
  "warning-border": "var(--vscode-inputValidation-warningBorder)",
  "status-reading": "var(--vscode-charts-yellow)",
  "status-done": "var(--vscode-charts-green)",
  font: "var(--vscode-font-family)",
  mono: "var(--vscode-editor-font-family)",
  "font-size": "var(--vscode-font-size)",
  "widget-shadow": "0 0 8px 2px var(--vscode-widget-shadow)",
};

// VS Code marks the theme kind on <body>; the tokens' own `color-scheme` is dark.
export function renderVscodeHostCss(): string {
  const lines = Object.entries(VSCODE_HOST_MAP).map(([name, value]) => `  --ls-${name}: ${value};`);
  return [
    "/* Maps the --ls-* tokens to VS Code theme variables. Generated from packages/core/src/ui/tokens by `pnpm --filter @labshelf/core tokens`. Do not edit. */",
    ":root {",
    ...lines,
    "}",
    "",
    "body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; --ls-plot-filter: none; }",
    "",
  ].join("\n");
}
