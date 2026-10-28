/**
 * Declares the design tokens: the token shape, the colour, type, spacing, shape, elevation and motion roles, the source editor's fonts and the annotation highlight palette.
 */
import type { AnnotationColor } from "../../model/index.js";

export interface DesignToken {
  value: string;
  light?: string;
}

export function createDesignToken(value: string, light?: string): DesignToken {
  return light === undefined ? { value } : { value, light };
}

// Each role stands in for the VS Code colour of the same purpose, so the browser
// surfaces read as the same product as the VS Code webviews.
export const COLOR_TOKENS = {
  "workspace-bg": createDesignToken("#141414", "#eeeeee"),
  bg: createDesignToken("#1f1f1f", "#ffffff"),
  fg: createDesignToken("#cccccc", "#3b3b3b"),
  desc: createDesignToken("#9d9d9d", "#717171"),
  error: createDesignToken("#f85149", "#a1260d"),
  link: createDesignToken("#4daafc", "#005fb8"),
  focus: createDesignToken("#0078d4", "#005fb8"),
  "editor-cursor": createDesignToken("#ffffff", "#000000"),
  "editor-selection-bg": createDesignToken("#264f78", "#add6ff"),
  "editor-inactive-selection-bg": createDesignToken("#3a3d41", "#e5ebf1"),

  "sidebar-bg": createDesignToken("#181818", "#f8f8f8"),
  "sidebar-border": createDesignToken("#2b2b2b", "#e5e5e5"),
  "section-fg": createDesignToken("#cccccc", "#3b3b3b"),
  "section-bg": createDesignToken("#181818", "#f8f8f8"),
  "section-border": createDesignToken("#2b2b2b", "#e5e5e5"),
  border: createDesignToken("#2b2b2b", "#e5e5e5"),
  "border-soft": createDesignToken("rgba(128, 128, 128, .2)", "rgba(128, 128, 128, .25)"),
  "border-faint": createDesignToken("rgba(128, 128, 128, .07)", "rgba(128, 128, 128, .1)"),
  "widget-bg": createDesignToken("#202020", "#f8f8f8"),
  "code-bg": createDesignToken("#2b2b2b", "#f8f8f8"),
  "sash-hover": createDesignToken("#0078d4", "#005fb8"),
  progress: createDesignToken("#0078d4", "#005fb8"),
  overlay: createDesignToken("rgba(0, 0, 0, .3)", "rgba(0, 0, 0, .18)"),

  "list-hover": createDesignToken("#2a2d2e", "#f2f2f2"),
  "list-active-bg": createDesignToken("#04395e", "#e8e8e8"),
  "list-active-fg": createDesignToken("#ffffff", "#000000"),
  "list-inactive-bg": createDesignToken("#37373d", "#e4e6f1"),
  "list-drop-bg": createDesignToken("#383b3d", "#d6ebff"),
  "list-focus-outline": createDesignToken("#0078d4", "#005fb8"),
  "tree-guide": createDesignToken("#585858", "#a9a9a9"),

  "menu-bg": createDesignToken("#1f1f1f", "#ffffff"),
  "menu-fg": createDesignToken("#cccccc", "#3b3b3b"),
  "menu-border": createDesignToken("#454545", "#cecece"),
  "menu-selection-bg": createDesignToken("#0078d4", "#005fb8"),
  "menu-selection-fg": createDesignToken("#ffffff", "#ffffff"),
  "menu-separator": createDesignToken("#454545", "#e5e5e5"),

  "button-bg": createDesignToken("#0078d4", "#005fb8"),
  "button-fg": createDesignToken("#ffffff", "#ffffff"),
  "button-hover": createDesignToken("#026ec1", "#0258a8"),
  "button-soft-fg": createDesignToken("#66b1f3", "#0c589f"),
  // Tints over the foreground and focus colours follow any host theme without a map entry.
  "button-soft-bg": createDesignToken("color-mix(in srgb, var(--ls-focus) 16%, transparent)"),
  "button-soft-hover": createDesignToken("color-mix(in srgb, var(--ls-focus) 24%, transparent)"),
  "row-rule": createDesignToken("color-mix(in srgb, var(--ls-fg) 8%, transparent)"),
  "row-open": createDesignToken("color-mix(in srgb, var(--ls-fg) 7%, transparent)"),
  "row-selected": createDesignToken("color-mix(in srgb, var(--ls-focus) 15%, transparent)"),
  "button2-bg": createDesignToken("#313131", "#e5e5e5"),
  "button2-fg": createDesignToken("#cccccc", "#3b3b3b"),
  "button2-hover": createDesignToken("#3c3c3c", "#cccccc"),
  "input-bg": createDesignToken("#313131", "#ffffff"),
  "input-fg": createDesignToken("#cccccc", "#3b3b3b"),
  "input-border": createDesignToken("#3c3c3c", "#cecece"),
  "input-placeholder": createDesignToken("#989898", "#767676"),
  "toolbar-hover": createDesignToken("rgba(90, 93, 94, .31)", "rgba(184, 184, 184, .31)"),
  "toolbar-active": createDesignToken("rgba(99, 102, 103, .31)", "rgba(166, 166, 166, .31)"),
  "badge-bg": createDesignToken("#616161", "#cccccc"),
  "badge-fg": createDesignToken("#f8f8f8", "#3b3b3b"),
  "kbd-fg": createDesignToken("#cccccc", "#3b3b3b"),
  "kbd-bg": createDesignToken("rgba(128, 128, 128, .17)", "rgba(221, 221, 221, .4)"),
  "kbd-border": createDesignToken("rgba(51, 51, 51, .6)", "rgba(204, 204, 204, .4)"),
  "kbd-bottom": createDesignToken("rgba(68, 68, 68, .6)", "rgba(187, 187, 187, .4)"),
  scrollbar: createDesignToken("rgba(121, 121, 121, .4)", "rgba(100, 100, 100, .4)"),
  "scrollbar-hover": createDesignToken("rgba(100, 100, 100, .7)", "rgba(100, 100, 100, .7)"),
  "scrollbar-active": createDesignToken("rgba(191, 191, 191, .4)", "rgba(0, 0, 0, .6)"),

  blue: createDesignToken("#3794ff", "#007acc"),
  yellow: createDesignToken("#cca700", "#b89500"),
  green: createDesignToken("#89d185", "#388a34"),
  "find-match": createDesignToken("rgba(234, 92, 0, .33)"),
  warning: createDesignToken("#cca700", "#bf8803"),
  "warning-bg": createDesignToken("#352a05", "#f6f5d2"),
  "warning-border": createDesignToken("#b89500", "#b89500"),
} satisfies Record<string, DesignToken>;

// Unread follows the blue role, so it needs no light value of its own.
export const STATUS_TOKENS = {
  "status-unread": createDesignToken("var(--ls-blue)"),
  "status-reading": createDesignToken("#e5c07b", "#c9a227"),
  "status-done": createDesignToken("#4ec994", "#2e9e6b"),
} satisfies Record<string, DesignToken>;

// Status marks stay brand colours in every host, so these have no VS Code mapping.
// They are the error, warning, green and blue roles with the saturation taken down.
export const MARK_TOKENS = {
  "mark-err": createDesignToken("#d9736d", "#a8483a"),
  "mark-warn": createDesignToken("#c9ad4a", "#a8822f"),
  "mark-ok": createDesignToken("#93c190", "#4d8a4a"),
  "mark-accent": createDesignToken("#6ea3e0", "#3a78ad"),
} satisfies Record<string, DesignToken>;

// File types are brand colours in every host, so these have no VS Code mapping.
// They are the error, reading and warning tones, kept opaque for 4.5:1 on the background.
export const FILE_TYPE_TOKENS = {
  "file-pdf": createDesignToken("#d9837c", "#b84a42"),
  "file-md": createDesignToken("#7d9fe0", "#4069b8"),
  "file-ref": createDesignToken("#7d9fe0", "#4069b8"),
  "file-tex": createDesignToken("#8cc27a", "#4a8a3a"),
  "file-typ": createDesignToken("#4cc4c9", "#1f8a93"),
  "file-dir": createDesignToken("#d2a865", "#946618"),
} satisfies Record<string, DesignToken>;

// The warm off-white of a light PDF sheet in the preview; the canvas multiplies over it, so the white of the page takes this tint.
export const SHEET_TOKENS = {
  "sheet-light": createDesignToken("#f4f3f0"),
} satisfies Record<string, DesignToken>;

export const TYPE_TOKENS = {
  font: createDesignToken('-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif'),
  // A brand face for paper titles, so it stays the same in every host; no font file ships, so the stack falls back to Georgia.
  serif: createDesignToken('"Source Serif 4", Georgia, serif'),
  mono: createDesignToken('Menlo, Monaco, "SF Mono", "Cascadia Code", Consolas, "Courier New", monospace'),
  "font-size": createDesignToken("13px"),
  "text-xs": createDesignToken("10px"),
  "text-sm": createDesignToken("11px"),
  "text-md": createDesignToken("12px"),
  "text-lg": createDesignToken("14px"),
  "text-xl": createDesignToken("15px"),
  "text-2xl": createDesignToken("17px"),
  "text-3xl": createDesignToken("24px"),
} satisfies Record<string, DesignToken>;

export const SPACE_TOKENS = {
  "space-1": createDesignToken("2px"),
  "space-2": createDesignToken("4px"),
  "space-3": createDesignToken("6px"),
  "space-4": createDesignToken("8px"),
  "space-5": createDesignToken("10px"),
  "space-6": createDesignToken("12px"),
  "space-7": createDesignToken("16px"),
  "space-8": createDesignToken("24px"),
  "space-9": createDesignToken("32px"),
} satisfies Record<string, DesignToken>;

export const SHAPE_TOKENS = {
  "editor-cursor-width": createDesignToken("3px"),
  "radius-sm": createDesignToken("3px"),
  radius: createDesignToken("4px"),
  "radius-lg": createDesignToken("6px"),
  "radius-pill": createDesignToken("999px"),
  "row-h": createDesignToken("22px"),
  "pane-footer-h": createDesignToken("24px"),
  "gallery-sidebar-w": createDesignToken("220px"),
  "gallery-card-w": createDesignToken("200px"),
  "gallery-content-w": createDesignToken("1200px"),
} satisfies Record<string, DesignToken>;

export const ELEVATION_TOKENS = {
  "pane-shadow": createDesignToken("0 1px 3px rgba(0, 0, 0, .18)", "0 1px 3px rgba(0, 0, 0, .08)"),
  "widget-shadow": createDesignToken("0 0 8px 2px rgba(0, 0, 0, .36)", "0 0 8px 2px rgba(0, 0, 0, .16)"),
  "popup-shadow": createDesignToken("0 4px 18px rgba(0, 0, 0, .45)", "0 4px 18px rgba(0, 0, 0, .18)"),
  "page-shadow": createDesignToken("0 1px 6px rgba(0, 0, 0, .3)"),
} satisfies Record<string, DesignToken>;

export const MOTION_TOKENS = {
  fast: createDesignToken("100ms"),
  normal: createDesignToken("140ms"),
} satisfies Record<string, DesignToken>;

export const CODE_FONT_NAMES = ["system", "jetbrains-mono", "fira-code", "atkinson-hyperlegible-mono", "opendyslexic"] as const;
export type SyntaxFontId = (typeof CODE_FONT_NAMES)[number];

export interface SyntaxFont {
  label: string;
  family: string;
}

// Every family but the system stack is a font file the browser extension bundles (see its build/vendorFonts.mjs).
export const CODE_FONTS: Record<SyntaxFontId, SyntaxFont> = {
  system: { label: "System monospace", family: "var(--ls-mono)" },
  "jetbrains-mono": { label: "JetBrains Mono", family: '"JetBrains Mono", var(--ls-mono)' },
  "fira-code": { label: "Fira Code", family: '"Fira Code", var(--ls-mono)' },
  "atkinson-hyperlegible-mono": { label: "Atkinson Hyperlegible Mono", family: '"Atkinson Hyperlegible Mono", var(--ls-mono)' },
  opendyslexic: { label: "OpenDyslexic", family: '"OpenDyslexic", var(--ls-mono)' },
};

export const CODE_FONT_TOKENS: Record<string, DesignToken> = { "code-font": createDesignToken(CODE_FONTS.system.family) };

// The library page marks the pick on <html data-code-font>.
export function renderCodeFontsCss(): string {
  return CODE_FONT_NAMES.filter((name) => name !== "system")
    .flatMap((name) => [`:root[data-code-font="${name}"] {`, `  --ls-code-font: ${CODE_FONTS[name].family};`, "}", ""])
    .join("\n");
}

// `note` paints an annotation that carries no colour of its own.
export const HIGHLIGHT_COLORS: Record<AnnotationColor | "note", string> = {
  yellow: "#f5c518",
  green: "#4caf50",
  blue: "#2196f3",
  red: "#f44336",
  pink: "#e91e63",
  note: "#9c27b0",
};
