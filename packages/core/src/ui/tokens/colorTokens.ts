/**
 * The colour roles of every LabShelf UI, valued after VS Code Dark Modern (default) and Light Modern.
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
  border: token("#2b2b2b", "#e5e5e5"),
  "border-soft": token("rgba(128, 128, 128, .2)", "rgba(128, 128, 128, .25)"),
  "border-faint": token("rgba(128, 128, 128, .07)", "rgba(128, 128, 128, .1)"),
  "widget-bg": token("#202020", "#f8f8f8"),
  "statusbar-bg": token("#181818", "#f8f8f8"),
  "statusbar-fg": token("#cccccc", "#3b3b3b"),
  "statusbar-hover": token("rgba(255, 255, 255, .12)", "rgba(0, 0, 0, .12)"),
  overlay: token("rgba(0, 0, 0, .3)", "rgba(0, 0, 0, .18)"),

  "list-hover": token("#2a2d2e", "#f2f2f2"),
  "list-active-bg": token("#04395e", "#e8e8e8"),
  "list-active-fg": token("#ffffff", "#000000"),
  "list-inactive-bg": token("#37373d", "#e4e6f1"),
  "list-drop-bg": token("#383b3d", "#d6ebff"),
  "indent-guide": token("rgba(88, 88, 88, .4)", "rgba(163, 163, 163, .4)"),

  "button-bg": token("#0078d4", "#005fb8"),
  "button-fg": token("#ffffff", "#ffffff"),
  "button-hover": token("#026ec1", "#0258a8"),
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
  "kbd-bg": token("rgba(128, 128, 128, .17)", "rgba(221, 221, 221, .4)"),
  "kbd-border": token("rgba(51, 51, 51, .6)", "rgba(204, 204, 204, .4)"),
  "kbd-bottom": token("rgba(68, 68, 68, .6)", "rgba(187, 187, 187, .4)"),
  scrollbar: token("rgba(121, 121, 121, .4)", "rgba(100, 100, 100, .4)"),
  "scrollbar-hover": token("rgba(100, 100, 100, .7)", "rgba(100, 100, 100, .7)"),

  blue: token("#3794ff", "#007acc"),
  yellow: token("#cca700", "#b89500"),
  green: token("#89d185", "#388a34"),
  "find-match": token("rgba(234, 92, 0, .33)"),
  "on-badge": token("#1e1e1e"),
} satisfies Record<string, DesignToken>;

// Unread follows the blue role, so it needs no light value of its own.
export const STATUS_TOKENS = {
  "status-unread": token("var(--ls-blue)"),
  "status-reading": token("#e5c07b", "#c9a227"),
  "status-done": token("#4ec994", "#2e9e6b"),
} satisfies Record<string, DesignToken>;
