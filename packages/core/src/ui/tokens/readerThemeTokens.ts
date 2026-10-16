/**
 * Declares the reader's page themes: the page colours pdf.js paints and the chrome colours around them, one row per theme.
 */

const READER_THEME_NAMES = ["dark", "light", "sepia", "high-contrast"] as const;
export type ReaderThemeName = (typeof READER_THEME_NAMES)[number];

export interface ReaderTheme {
  /** Page background pdf.js paints. */
  page: string;
  /** Page text pdf.js paints; never a CSS variable, pdf.js reads it from `THEME_PRESETS`. */
  ink: string;
  /** Backdrop around the pages. */
  bg: string;
  surface: string;
  border: string;
  fg: string;
  desc: string;
  hover: string;
  active: string;
  shadow: string;
  findHit: string;
  findCurrent: string;
  /** Fill of a region another version of the paper shows differently. */
  change: string;
}

const DARK_FIND = { findHit: "rgba(255, 213, 0, .35)", findCurrent: "rgba(255, 140, 0, .6)", change: "rgba(255, 140, 0, .2)" };

// The reader keeps its own chrome per theme, because a page theme can differ from the app theme.
export const READER_THEMES: Record<ReaderThemeName, ReaderTheme> = {
  dark: {
    page: "#1e1e1e", ink: "#e8e8e8", bg: "#1e1e1e",
    surface: "#252526", border: "#3c3c3c", fg: "#cccccc", desc: "#9a9a9a",
    hover: "rgba(255, 255, 255, .09)", active: "rgba(255, 255, 255, .15)",
    shadow: "0 4px 18px rgba(0, 0, 0, .45)", ...DARK_FIND,
  },
  light: {
    page: "#ffffff", ink: "#000000", bg: "#f0f0f0",
    surface: "#f6f6f6", border: "#d4d4d4", fg: "#2b2b2b", desc: "#6b6b6b",
    hover: "rgba(0, 0, 0, .07)", active: "rgba(0, 0, 0, .12)",
    shadow: "0 4px 18px rgba(0, 0, 0, .18)", ...DARK_FIND,
  },
  sepia: {
    page: "#faf6ee", ink: "#3a2a1a", bg: "#e8dfc8",
    surface: "#ede6d3", border: "#c8b89a", fg: "#4a3728", desc: "#72604e",
    hover: "rgba(74, 55, 40, .1)", active: "rgba(74, 55, 40, .17)",
    shadow: "0 4px 18px rgba(74, 55, 40, .25)", ...DARK_FIND,
  },
  "high-contrast": {
    page: "#000000", ink: "#ffffff", bg: "#000000",
    surface: "#000000", border: "#ffffff", fg: "#ffffff", desc: "#ffffff",
    hover: "rgba(255, 255, 255, .2)", active: "rgba(255, 255, 255, .3)",
    shadow: "0 4px 18px rgba(0, 0, 0, .45)",
    findHit: "rgba(0, 255, 255, .4)", findCurrent: "rgba(255, 0, 255, .6)", change: "rgba(255, 0, 255, .3)",
  },
};

const CSS_ROLES = ["page", "bg", "surface", "border", "fg", "desc", "hover", "active", "shadow"] as const;

function themeDeclarations(theme: ReaderTheme): string[] {
  return [
    ...CSS_ROLES.map((role) => `  --ls-reader-${role}: ${theme[role]};`),
    `  --ls-reader-find-hit: ${theme.findHit};`,
    `  --ls-reader-find-current: ${theme.findCurrent};`,
    `  --ls-reader-change: ${theme.change};`,
  ];
}

// The reader marks its theme on <html data-pdf-theme>; dark is also the default before
// the attribute is set. The swatches of the theme picker show every theme at once.
export function renderReaderThemesCss(): string {
  const swatches = READER_THEME_NAMES.flatMap((name) => [
    `  --ls-reader-swatch-${name}: ${READER_THEMES[name].page};`,
    `  --ls-reader-swatch-${name}-ink: ${READER_THEMES[name].ink};`,
  ]);
  const blocks = READER_THEME_NAMES.filter((name) => name !== "dark").flatMap((name) => [
    `[data-pdf-theme="${name}"] {`,
    ...themeDeclarations(READER_THEMES[name]),
    "}",
    "",
  ]);
  return [":root {", "  --ls-reader-toolbar-h: 38px;", ...themeDeclarations(READER_THEMES.dark), ...swatches, "}", "", ...blocks].join("\n");
}
