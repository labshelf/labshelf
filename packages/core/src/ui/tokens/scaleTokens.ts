/**
 * Declares the type scale, spacing, radii, elevation and motion shared by every LabShelf UI.
 */
import { token, type DesignToken } from "./designToken.js";

export const TYPE_TOKENS = {
  font: token('-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif'),
  mono: token('Menlo, Monaco, "SF Mono", "Cascadia Code", Consolas, "Courier New", monospace'),
  "font-size": token("13px"),
  "text-xs": token("10px"),
  "text-sm": token("11px"),
  "text-md": token("12px"),
  "text-lg": token("14px"),
} satisfies Record<string, DesignToken>;

// The steps are the padding and gap values the three UIs already use most.
export const SPACE_TOKENS = {
  "space-1": token("2px"),
  "space-2": token("4px"),
  "space-3": token("6px"),
  "space-4": token("8px"),
  "space-5": token("10px"),
  "space-6": token("12px"),
  "space-7": token("16px"),
} satisfies Record<string, DesignToken>;

export const SHAPE_TOKENS = {
  "radius-sm": token("3px"),
  radius: token("4px"),
  "radius-lg": token("6px"),
  "radius-pill": token("999px"),
  "row-h": token("22px"),
} satisfies Record<string, DesignToken>;

export const ELEVATION_TOKENS = {
  "widget-shadow": token("0 0 8px 2px rgba(0, 0, 0, .36)", "0 0 8px 2px rgba(0, 0, 0, .16)"),
  "popup-shadow": token("0 4px 18px rgba(0, 0, 0, .45)", "0 4px 18px rgba(0, 0, 0, .18)"),
  "page-shadow": token("0 1px 6px rgba(0, 0, 0, .3)"),
} satisfies Record<string, DesignToken>;

export const MOTION_TOKENS = {
  fast: token("100ms"),
  normal: token("140ms"),
} satisfies Record<string, DesignToken>;
