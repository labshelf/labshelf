/**
 * Declares the colour roles of every LabShelf UI, valued after VS Code Dark Modern (default) and Light Modern.
 */
import { token, type DesignToken } from "./designToken.js";

// Each role stands in for the VS Code colour of the same purpose, so the browser
// surfaces read as the same product as the VS Code webviews.
export const COLOR_TOKENS = {
  bg: token("#1f1f1f", "#ffffff"),
  fg: token("#cccccc", "#3b3b3b"),
  desc: token("#9d9d9d", "#717171"),
  error: token("#f85149", "#a1260d"),
  link: token("#4daafc", "#005fb8"),
  focus: token("#0078d4", "#005fb8"),

  "sidebar-bg": token("#181818", "#f8f8f8"),
  "sidebar-border": token("#2b2b2b", "#e5e5e5"),
  "section-fg": token("#cccccc", "#3b3b3b"),
  "section-bg": token("#181818", "#f8f8f8"),
  "section-border": token("#2b2b2b", "#e5e5e5"),
  border: token("#2b2b2b", "#e5e5e5"),
  "border-soft": token("rgba(128, 128, 128, .2)", "rgba(128, 128, 128, .25)"),
  "border-faint": token("rgba(128, 128, 128, .07)", "rgba(128, 128, 128, .1)"),
  "widget-bg": token("#202020", "#f8f8f8"),
  "code-bg": token("#2b2b2b", "#f8f8f8"),
  "tab-active-border": token("#0078d4", "#005fb8"),
  "sash-hover": token("#0078d4", "#005fb8"),
  progress: token("#0078d4", "#005fb8"),
  "statusbar-bg": token("#181818", "#f8f8f8"),
  "statusbar-fg": token("#cccccc", "#3b3b3b"),
  "statusbar-hover": token("rgba(255, 255, 255, .12)", "rgba(0, 0, 0, .12)"),
  overlay: token("rgba(0, 0, 0, .3)", "rgba(0, 0, 0, .18)"),

  "list-hover": token("#2a2d2e", "#f2f2f2"),
  "list-active-bg": token("#04395e", "#e8e8e8"),
  "list-active-fg": token("#ffffff", "#000000"),
  "list-inactive-bg": token("#37373d", "#e4e6f1"),
  "list-drop-bg": token("#383b3d", "#d6ebff"),
  "list-focus-outline": token("#0078d4", "#005fb8"),
  "indent-guide": token("rgba(88, 88, 88, .4)", "rgba(163, 163, 163, .4)"),

  "menu-bg": token("#1f1f1f", "#ffffff"),
  "menu-fg": token("#cccccc", "#3b3b3b"),
  "menu-border": token("#454545", "#cecece"),
  "menu-selection-bg": token("#0078d4", "#005fb8"),
  "menu-selection-fg": token("#ffffff", "#ffffff"),
  "menu-separator": token("#454545", "#e5e5e5"),

  "button-bg": token("#0078d4", "#005fb8"),
  "button-fg": token("#ffffff", "#ffffff"),
  "button-hover": token("#026ec1", "#0258a8"),
  "button-soft-fg": token("#66b1f3", "#0c589f"),
  // Tints over the foreground and focus colours follow any host theme without a map entry.
  "button-soft-bg": token("color-mix(in srgb, var(--ls-focus) 16%, transparent)"),
  "button-soft-hover": token("color-mix(in srgb, var(--ls-focus) 24%, transparent)"),
  "row-zebra": token("color-mix(in srgb, var(--ls-fg) 3%, transparent)"),
  "row-open": token("color-mix(in srgb, var(--ls-fg) 7%, transparent)"),
  "row-selected": token("color-mix(in srgb, var(--ls-focus) 15%, transparent)"),
  "button2-bg": token("#313131", "#e5e5e5"),
  "button2-fg": token("#cccccc", "#3b3b3b"),
  "button2-hover": token("#3c3c3c", "#cccccc"),
  "input-bg": token("#313131", "#ffffff"),
  "input-fg": token("#cccccc", "#3b3b3b"),
  "input-border": token("#3c3c3c", "#cecece"),
  "input-placeholder": token("#989898", "#767676"),
  "toolbar-hover": token("rgba(90, 93, 94, .31)", "rgba(184, 184, 184, .31)"),
  "toolbar-active": token("rgba(99, 102, 103, .31)", "rgba(166, 166, 166, .31)"),
  "badge-bg": token("#616161", "#cccccc"),
  "badge-fg": token("#f8f8f8", "#3b3b3b"),
  "kbd-fg": token("#cccccc", "#3b3b3b"),
  "kbd-bg": token("rgba(128, 128, 128, .17)", "rgba(221, 221, 221, .4)"),
  "kbd-border": token("rgba(51, 51, 51, .6)", "rgba(204, 204, 204, .4)"),
  "kbd-bottom": token("rgba(68, 68, 68, .6)", "rgba(187, 187, 187, .4)"),
  scrollbar: token("rgba(121, 121, 121, .4)", "rgba(100, 100, 100, .4)"),
  "scrollbar-hover": token("rgba(100, 100, 100, .7)", "rgba(100, 100, 100, .7)"),
  "scrollbar-active": token("rgba(191, 191, 191, .4)", "rgba(0, 0, 0, .6)"),

  blue: token("#3794ff", "#007acc"),
  yellow: token("#cca700", "#b89500"),
  green: token("#89d185", "#388a34"),
  "find-match": token("rgba(234, 92, 0, .33)"),
  warning: token("#cca700", "#bf8803"),
  "warning-bg": token("#352a05", "#f6f5d2"),
  "warning-border": token("#b89500", "#b89500"),
} satisfies Record<string, DesignToken>;

// Unread follows the blue role, so it needs no light value of its own.
export const STATUS_TOKENS = {
  "status-unread": token("var(--ls-blue)"),
  "status-reading": token("#e5c07b", "#c9a227"),
  "status-done": token("#4ec994", "#2e9e6b"),
} satisfies Record<string, DesignToken>;

// Status marks stay brand colours in every host, so these have no VS Code mapping.
// They are the error, warning, green and blue roles with the saturation taken down.
export const MARK_TOKENS = {
  "mark-err": token("#d9736d", "#a8483a"),
  "mark-warn": token("#c9ad4a", "#a8822f"),
  "mark-ok": token("#93c190", "#4d8a4a"),
  "mark-accent": token("#6ea3e0", "#3a78ad"),
} satisfies Record<string, DesignToken>;

// File types are brand colours in every host, so these have no VS Code mapping.
// They are the error, reading and warning tones, kept opaque for 4.5:1 on the background.
export const FILE_TYPE_TOKENS = {
  "file-pdf": token("#d9837c", "#b84a42"),
  "file-md": token("#7d9fe0", "#4069b8"),
  "file-ref": token("#7d9fe0", "#4069b8"),
  "file-dir": token("#d2a865", "#946618"),
} satisfies Record<string, DesignToken>;
