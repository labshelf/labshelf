// Defines typography, spacing, shape, elevation and motion tokens for LabShelf UI.
import { createDesignToken, type DesignToken } from "./designToken.js";

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
