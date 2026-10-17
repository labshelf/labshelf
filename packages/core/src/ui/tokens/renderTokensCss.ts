/**
 * Renders the design tokens as the `--ls-*` stylesheet that `ui/dom/tokens.css` holds.
 */
import { COLOR_TOKENS, FILE_TYPE_TOKENS, MARK_TOKENS, SHEET_TOKENS, STATUS_TOKENS } from "./colorTokens.js";
import { token, type DesignToken } from "./designToken.js";
import { HIGHLIGHT_COLORS } from "./highlightTokens.js";
import { renderReaderThemesCss } from "./readerThemeTokens.js";
import { ELEVATION_TOKENS, MOTION_TOKENS, SHAPE_TOKENS, SPACE_TOKENS, TYPE_TOKENS } from "./scaleTokens.js";

const ALL_TOKENS: Record<string, DesignToken> = {
  ...COLOR_TOKENS,
  ...STATUS_TOKENS,
  ...MARK_TOKENS,
  ...FILE_TYPE_TOKENS,
  ...SHEET_TOKENS,
  ...Object.fromEntries(Object.entries(HIGHLIGHT_COLORS).map(([name, value]) => [`hl-${name}`, token(value)])),
  ...TYPE_TOKENS,
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
  ].join("\n") + renderReaderThemesCss();
}
