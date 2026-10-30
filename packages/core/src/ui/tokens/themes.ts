/**
 * Declares the colour themes: the reader's page themes and the source editor's syntax themes, with the CSS each renders.
 */
import { PLOT_INVERT_FILTER, createDesignToken, type DesignToken } from "./tokens.js";

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
  /** CSS filter over a plot image, whose stored ink is dark on a transparent background: dark themes invert it, keeping hues. */
  plotFilter: string;
}

const DARK_FIND = { findHit: "rgba(255, 213, 0, .35)", findCurrent: "rgba(255, 140, 0, .6)", change: "rgba(255, 140, 0, .2)" };

// The reader keeps its own chrome per theme, because a page theme can differ from the app theme.
export const READER_THEMES: Record<ReaderThemeName, ReaderTheme> = {
  dark: {
    page: "#1e1e1e", ink: "#e8e8e8", bg: "#1e1e1e",
    surface: "#252526", border: "#3c3c3c", fg: "#cccccc", desc: "#9a9a9a",
    hover: "rgba(255, 255, 255, .09)", active: "rgba(255, 255, 255, .15)",
    shadow: "0 4px 18px rgba(0, 0, 0, .45)", ...DARK_FIND, plotFilter: PLOT_INVERT_FILTER,
  },
  light: {
    page: "#ffffff", ink: "#000000", bg: "#f0f0f0",
    surface: "#f6f6f6", border: "#d4d4d4", fg: "#2b2b2b", desc: "#6b6b6b",
    hover: "rgba(0, 0, 0, .07)", active: "rgba(0, 0, 0, .12)",
    shadow: "0 4px 18px rgba(0, 0, 0, .18)", ...DARK_FIND, plotFilter: "none",
  },
  sepia: {
    page: "#faf6ee", ink: "#3a2a1a", bg: "#e8dfc8",
    surface: "#ede6d3", border: "#c8b89a", fg: "#4a3728", desc: "#72604e",
    hover: "rgba(74, 55, 40, .1)", active: "rgba(74, 55, 40, .17)",
    shadow: "0 4px 18px rgba(74, 55, 40, .25)", ...DARK_FIND, plotFilter: "none",
  },
  "high-contrast": {
    page: "#000000", ink: "#ffffff", bg: "#000000",
    surface: "#000000", border: "#ffffff", fg: "#ffffff", desc: "#ffffff",
    hover: "rgba(255, 255, 255, .2)", active: "rgba(255, 255, 255, .3)",
    shadow: "0 4px 18px rgba(0, 0, 0, .45)",
    findHit: "rgba(0, 255, 255, .4)", findCurrent: "rgba(255, 0, 255, .6)", change: "rgba(255, 0, 255, .3)",
    plotFilter: PLOT_INVERT_FILTER,
  },
};

const CSS_ROLES = ["page", "bg", "surface", "border", "fg", "desc", "hover", "active", "shadow"] as const;

function themeDeclarations(theme: ReaderTheme): string[] {
  return [
    ...CSS_ROLES.map((role) => `  --ls-reader-${role}: ${theme[role]};`),
    `  --ls-reader-find-hit: ${theme.findHit};`,
    `  --ls-reader-find-current: ${theme.findCurrent};`,
    `  --ls-reader-change: ${theme.change};`,
    `  --ls-reader-plot-filter: ${theme.plotFilter};`,
  ];
}

/** Every CSS custom property a reader theme sets, by name, for themes applied inline (custom themes). */
export function readerThemeCssVars(theme: ReaderTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const role of CSS_ROLES) { vars[`--ls-reader-${role}`] = theme[role]; }
  vars["--ls-reader-find-hit"] = theme.findHit;
  vars["--ls-reader-find-current"] = theme.findCurrent;
  vars["--ls-reader-change"] = theme.change;
  vars["--ls-reader-plot-filter"] = theme.plotFilter;
  return vars;
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** @returns `a` moved toward `b` by `t` (0..1), as #rrggbb. */
function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex(x.map((c, i) => c + (y[i]! - c) * t));
}

/** True when a #rrggbb colour reads as light (WCAG relative luminance of at least 0.5). */
export function isLightColour(hex: string): boolean {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.5;
}

/**
 * Builds a full reader theme from a custom theme's page and ink (#rrggbb): the chrome is mixed from the two, and the
 * shadow, find colours and plot filter come from the light or dark preset the page colour is closest to.
 */
export function deriveReaderTheme(page: string, ink: string): ReaderTheme {
  const base = READER_THEMES[isLightColour(page) ? "light" : "dark"];
  const [r, g, b] = parseHex(ink);
  return {
    ...base,
    page,
    ink,
    bg: mixHex(page, ink, 0.06),
    surface: mixHex(page, ink, 0.04),
    border: mixHex(page, ink, 0.2),
    fg: mixHex(ink, page, 0.1),
    desc: mixHex(ink, page, 0.38),
    hover: `rgba(${r}, ${g}, ${b}, .09)`,
    active: `rgba(${r}, ${g}, ${b}, .15)`,
  };
}

// The reader marks its theme on <html data-pdf-theme>; dark is also the default before
// the attribute is set. A theme block declares only what differs from dark, which it inherits from :root.
// The swatches of the theme picker show every theme at once.
export function renderReaderThemesCss(): string {
  const swatches = READER_THEME_NAMES.flatMap((name) => [
    `  --ls-reader-swatch-${name}: ${READER_THEMES[name].page};`,
    `  --ls-reader-swatch-${name}-ink: ${READER_THEMES[name].ink};`,
  ]);
  const darkDeclarations = themeDeclarations(READER_THEMES.dark);
  const blocks = READER_THEME_NAMES.filter((name) => name !== "dark").flatMap((name) => [
    `[data-pdf-theme="${name}"] {`,
    ...themeDeclarations(READER_THEMES[name]).filter((line) => !darkDeclarations.includes(line)),
    "}",
    "",
  ]);
  return [":root {", "  --ls-reader-toolbar-h: 38px;", ...darkDeclarations, ...swatches, "}", "", ...blocks].join("\n");
}

const CODE_ROLES = ["keyword", "command", "argument", "string", "number", "math", "comment", "heading", "reference", "bracket"] as const;
type SyntaxRole = (typeof CODE_ROLES)[number];

export const CODE_THEME_NAMES = ["labshelf", "one", "github", "catppuccin", "solarized"] as const;
export type SyntaxThemeId = (typeof CODE_THEME_NAMES)[number];

export interface CodeTheme {
  label: string;
  colors: Record<SyntaxRole, DesignToken>;
}

const defineCodeTheme = (label: string, dark: string[], light: string[]): CodeTheme => ({
  label,
  colors: Object.fromEntries(CODE_ROLES.map((role, i) => [role, createDesignToken(dark[i]!, light[i]!)])) as Record<SyntaxRole, DesignToken>,
});

// Colours follow each theme's published palette, in CODE_ROLES order; a few are darkened or lightened just enough
// to reach 4.5:1 on the app background, which every theme keeps.
export const CODE_THEMES: Record<SyntaxThemeId, CodeTheme> = {
  labshelf: defineCodeTheme("LabShelf",
    ["#c586c0", "#569cd6", "#4ec9b0", "#ce9178", "#b5cea8", "#dcdcaa", "#6a9955", "#569cd6", "#9cdcfe", "#ffd700"],
    ["#af00db", "#0000ff", "#267e97", "#a31515", "#098658", "#795e26", "#008000", "#800000", "#001080", "#0431fa"]),
  one: defineCodeTheme("One",
    ["#c678dd", "#61afef", "#d19a66", "#98c379", "#d19a66", "#56b6c2", "#838891", "#e06c75", "#e5c07b", "#abb2bf"],
    ["#a626a4", "#3b6edf", "#986801", "#418240", "#986801", "#017cb1", "#696c77", "#c64b40", "#9c6b01", "#383a42"]),
  github: defineCodeTheme("GitHub",
    ["#ff7b72", "#d2a8ff", "#79c0ff", "#a5d6ff", "#79c0ff", "#ffa657", "#8b949e", "#58a6ff", "#7ee787", "#c9d1d9"],
    ["#cf222e", "#8250df", "#0550ae", "#0a3069", "#0550ae", "#953800", "#6d7680", "#0550ae", "#116329", "#24292f"]),
  catppuccin: defineCodeTheme("Catppuccin",
    ["#cba6f7", "#89b4fa", "#fab387", "#a6e3a1", "#fab387", "#94e2d5", "#9399b2", "#f38ba8", "#f9e2af", "#bac2de"],
    ["#8839ef", "#1e66f5", "#c64e09", "#358524", "#c64e09", "#148087", "#717486", "#d20f39", "#a36815", "#5c5f77"]),
  solarized: defineCodeTheme("Solarized",
    ["#859900", "#2d8ed3", "#2aa198", "#2aa198", "#db5a99", "#7e82cb", "#839496", "#d46a3e", "#b58900", "#93a1a1"],
    ["#6c7c00", "#217ab9", "#22827b", "#22827b", "#d13581", "#686cbc", "#62777f", "#cb4b16", "#936f00", "#586e75"]),
};

/** The default theme as `code-<role>` tokens, rendered into the main dark and light blocks. */
export const CODE_THEME_TOKENS: Record<string, DesignToken> = Object.fromEntries(
  CODE_ROLES.map((role) => [`code-${role}`, CODE_THEMES.labshelf.colors[role]]),
);

// The library page marks the pick on <html data-code-theme>.
// TRAP: `:root[data-code-theme]` ties `:root[data-theme="light"]` in specificity and wins only by coming after it.
export function renderCodeThemesCss(): string {
  return CODE_THEME_NAMES.filter((name) => name !== "labshelf").flatMap((name) => {
    const { colors } = CODE_THEMES[name];
    return [
      `:root[data-code-theme="${name}"] {`, ...CODE_ROLES.map((role) => `  --ls-code-${role}: ${colors[role].value};`), "}", "",
      `:root[data-theme="light"][data-code-theme="${name}"] {`, ...CODE_ROLES.map((role) => `  --ls-code-${role}: ${colors[role].light};`), "}", "",
    ];
  }).join("\n");
}
