// Reads and merges the stored workspace prefs: the raw JSON object, its lists, widths, code style and Details pane, and the object a patch writes back.
import { CODE_FONT_NAMES, CODE_THEME_NAMES, type SyntaxFontId, type SyntaxThemeId } from "../ui/index.js";
import { normalizePrefs } from "./store/index.js";

export interface DetailPanePrefs {
  /** Null until the user drags the pane's sash. */
  detailWidth: number | null;
  detailCollapsed: boolean;
  rightPane: "details" | "chat";
}

export interface CodeStyle {
  codeTheme: SyntaxThemeId;
  codeFont: SyntaxFontId;
}

/** Parses the stored text into a plain object; empty when it is missing, corrupt or not an object. */
export function parseStoredPrefs(text: string | null): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(text ?? "null");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function deriveStringList(raw: Record<string, unknown>, field: string): string[] {
  const v = raw[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function deriveEditorWidth(raw: Record<string, unknown>): number | null {
  const v = raw["editorWidth"];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export function deriveCodeStyle(raw: Record<string, unknown>): CodeStyle {
  const pick = <T extends string>(names: readonly T[], v: unknown): T => (names.includes(v as T) ? (v as T) : names[0]!);
  return { codeTheme: pick(CODE_THEME_NAMES, raw["codeTheme"]), codeFont: pick(CODE_FONT_NAMES, raw["codeFont"]) };
}

export function deriveDetailPane(raw: Record<string, unknown>): DetailPanePrefs {
  const w = raw["detailWidth"];
  return {
    detailWidth: typeof w === "number" && Number.isFinite(w) && w > 0 ? w : null,
    detailCollapsed: raw["detailCollapsed"] === true,
    rightPane: raw["rightPane"] === "chat" ? "chat" : "details",
  };
}

// INVARIANT: An unset width keeps following the sidebar width.
function detailPaneFields(raw: Record<string, unknown>): Partial<DetailPanePrefs> {
  const { detailWidth, detailCollapsed, rightPane } = deriveDetailPane(raw);
  return detailWidth === null ? { detailCollapsed, rightPane } : { detailWidth, detailCollapsed, rightPane };
}

/** The object to store: the stored one normalised, with the patch laid over it. */
export function mergePrefs(raw: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const editorWidth = deriveEditorWidth(raw);
  return {
    ...normalizePrefs(raw), treeExpanded: deriveStringList(raw, "treeExpanded"), collapsedSections: deriveStringList(raw, "collapsedSections"),
    ...(editorWidth === null ? {} : { editorWidth }), ...deriveCodeStyle(raw), ...detailPaneFields(raw), ...patch,
  };
}
