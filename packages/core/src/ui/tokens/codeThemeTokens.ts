/**
 * Declares the syntax colour themes of the source editor: one colour per highlight role, for the dark and the light app theme.
 */
import { token, type DesignToken } from "./designToken.js";

const CODE_ROLES = ["keyword", "command", "argument", "string", "number", "math", "comment", "heading", "reference", "bracket"] as const;
export type CodeRole = (typeof CODE_ROLES)[number];

export const CODE_THEME_NAMES = ["labshelf", "one", "github", "catppuccin", "solarized"] as const;
export type CodeThemeName = (typeof CODE_THEME_NAMES)[number];

export interface CodeTheme {
  label: string;
  colors: Record<CodeRole, DesignToken>;
}

const theme = (label: string, dark: string[], light: string[]): CodeTheme => ({
  label,
  colors: Object.fromEntries(CODE_ROLES.map((role, i) => [role, token(dark[i]!, light[i]!)])) as Record<CodeRole, DesignToken>,
});

// Colours follow each theme's published palette, in CODE_ROLES order; a few are darkened or lightened just enough
// to reach 4.5:1 on the app background, which every theme keeps.
export const CODE_THEMES: Record<CodeThemeName, CodeTheme> = {
  labshelf: theme("LabShelf",
    ["#c586c0", "#569cd6", "#4ec9b0", "#ce9178", "#b5cea8", "#dcdcaa", "#6a9955", "#569cd6", "#9cdcfe", "#ffd700"],
    ["#af00db", "#0000ff", "#267e97", "#a31515", "#098658", "#795e26", "#008000", "#800000", "#001080", "#0431fa"]),
  one: theme("One",
    ["#c678dd", "#61afef", "#d19a66", "#98c379", "#d19a66", "#56b6c2", "#838891", "#e06c75", "#e5c07b", "#abb2bf"],
    ["#a626a4", "#3b6edf", "#986801", "#418240", "#986801", "#017cb1", "#696c77", "#c64b40", "#9c6b01", "#383a42"]),
  github: theme("GitHub",
    ["#ff7b72", "#d2a8ff", "#79c0ff", "#a5d6ff", "#79c0ff", "#ffa657", "#8b949e", "#58a6ff", "#7ee787", "#c9d1d9"],
    ["#cf222e", "#8250df", "#0550ae", "#0a3069", "#0550ae", "#953800", "#6d7680", "#0550ae", "#116329", "#24292f"]),
  catppuccin: theme("Catppuccin",
    ["#cba6f7", "#89b4fa", "#fab387", "#a6e3a1", "#fab387", "#94e2d5", "#9399b2", "#f38ba8", "#f9e2af", "#bac2de"],
    ["#8839ef", "#1e66f5", "#c64e09", "#358524", "#c64e09", "#148087", "#717486", "#d20f39", "#a36815", "#5c5f77"]),
  solarized: theme("Solarized",
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
