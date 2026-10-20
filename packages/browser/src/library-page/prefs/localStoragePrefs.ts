/**
 * Stores the library page's preferences in localStorage under one key: the shared library UI prefs plus the
 * sidebar tree's expanded folders and collapsed sections, the editor area's first-group width and the source editor's code
 * colours and font. A corrupt or missing entry falls back to the defaults field by field.
 */
import {
  CODE_FONT_NAMES, CODE_THEME_NAMES, sanitizePrefs, type CodeFontName, type CodeThemeName, type LibraryUiPrefs, type PrefsPort,
} from "@labshelf/core";

export const PREFS_KEY = "labshelf.library.prefs";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export interface PagePrefs extends PrefsPort {
  treeExpanded(): string[];
  saveTreeExpanded(paths: string[]): void;
  collapsedSections(): string[];
  saveCollapsedSections(ids: string[]): void;
  /** The first editor group's width in pixels while two groups show; null until the user drags the sash. */
  editorWidth(): number | null;
  saveEditorWidth(width: number): void;
  /** The page-level Details pane's width and collapsed state. */
  detailPane(): DetailPanePrefs;
  saveDetailPane(patch: Partial<DetailPanePrefs>): void;
  codeStyle(): CodeStyle;
  saveCodeStyle(patch: Partial<CodeStyle>): void;
}

interface DetailPanePrefs {
  /** Null until the user drags the pane's sash. */
  detailWidth: number | null;
  detailCollapsed: boolean;
}

interface CodeStyle {
  codeTheme: CodeThemeName;
  codeFont: CodeFontName;
}

function readRaw(storage: PrefsStorage): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(storage.getItem(PREFS_KEY) ?? "null");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createLocalStoragePrefs(storage: PrefsStorage = localStorage): PagePrefs {
  const write = (patch: Record<string, unknown>): void => {
    const raw = readRaw(storage);
    const editorWidth = widthOf(raw);
    const next = {
      ...sanitizePrefs(raw), treeExpanded: stringsOf(raw, "treeExpanded"), collapsedSections: stringsOf(raw, "collapsedSections"),
      ...(editorWidth === null ? {} : { editorWidth }), ...codeStyleOf(raw), ...detailPaneFields(raw), ...patch,
    };
    // Private windows can refuse writes; the page then works with the in-memory state only.
    try { storage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  return {
    load: () => sanitizePrefs(readRaw(storage)),
    save: (patch: Partial<LibraryUiPrefs>) => write(patch),
    treeExpanded: () => stringsOf(readRaw(storage), "treeExpanded"),
    saveTreeExpanded: (paths) => write({ treeExpanded: paths }),
    collapsedSections: () => stringsOf(readRaw(storage), "collapsedSections"),
    saveCollapsedSections: (ids) => write({ collapsedSections: ids }),
    editorWidth: () => widthOf(readRaw(storage)),
    saveEditorWidth: (width) => write({ editorWidth: width }),
    detailPane: () => detailPaneOf(readRaw(storage)),
    saveDetailPane: (patch) => write(patch),
    codeStyle: () => codeStyleOf(readRaw(storage)),
    saveCodeStyle: (patch) => write(patch),
  };
}

function stringsOf(raw: Record<string, unknown>, field: string): string[] {
  const v = raw[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function widthOf(raw: Record<string, unknown>): number | null {
  const v = raw["editorWidth"];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function codeStyleOf(raw: Record<string, unknown>): CodeStyle {
  const pick = <T extends string>(names: readonly T[], v: unknown): T => (names.includes(v as T) ? (v as T) : names[0]!);
  return { codeTheme: pick(CODE_THEME_NAMES, raw["codeTheme"]), codeFont: pick(CODE_FONT_NAMES, raw["codeFont"]) };
}

// An unset width is left out, so it keeps following the sidebar's.
function detailPaneFields(raw: Record<string, unknown>): Partial<DetailPanePrefs> {
  const { detailWidth, detailCollapsed } = detailPaneOf(raw);
  return detailWidth === null ? { detailCollapsed } : { detailWidth, detailCollapsed };
}

function detailPaneOf(raw: Record<string, unknown>): DetailPanePrefs {
  const w = raw["detailWidth"];
  return {
    detailWidth: typeof w === "number" && Number.isFinite(w) && w > 0 ? w : null,
    detailCollapsed: raw["detailCollapsed"] === true,
  };
}
