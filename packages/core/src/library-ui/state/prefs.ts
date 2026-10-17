/**
 * Declares the library UI preferences a host persists (sort, panes, folded sections, detail tab, citation style),
 * the port it persists them through, and `sanitizePrefs`, which turns whatever storage returns into valid prefs.
 */
import { COLUMN_KEYS, DEFAULT_COLUMNS, type ColumnKey } from "./columns.js";
import type { SortDir, SortKey } from "./viewState.js";

export const DETAIL_TABS = ["details", "annotations", "notes", "related"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export const CITE_FORMATS = ["bibtex", "apa", "mla", "chicago", "inText"] as const;
export type CiteFormat = (typeof CITE_FORMATS)[number];

export interface LibraryUiPrefs {
  sortKey: SortKey;
  sortDir: SortDir;
  columns: ColumnKey[];
  detailWidth: number;
  detailCollapsed: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  secCollapsed: Record<string, boolean>;
  detailTab: DetailTab;
  citeFormat: CiteFormat;
}

/** Where a host keeps the prefs: localStorage in the browser, webview state in VS Code. */
export interface PrefsPort {
  load(): LibraryUiPrefs;
  save(patch: Partial<LibraryUiPrefs>): void;
}

/** The four keys the pane frame persists; a host that shows panes without the rest of the library prefs stores only these. */
export type PanePrefs = Pick<LibraryUiPrefs, "detailWidth" | "detailCollapsed" | "sidebarWidth" | "sidebarCollapsed">;

export interface PanePrefsPort {
  load(): PanePrefs;
  save(patch: Partial<PanePrefs>): void;
}

/** Drag limits of the two side panes; dragging below `collapseAt` hides the pane. */
export const PANE_LIMITS = {
  sidebar: { min: 160, max: 420, collapseAt: 110 },
  detail: { min: 260, max: 760, collapseAt: 180 },
} as const;

export const DEFAULT_PREFS: LibraryUiPrefs = {
  sortKey: "title",
  sortDir: 1,
  columns: DEFAULT_COLUMNS,
  detailWidth: 360,
  detailCollapsed: false,
  sidebarWidth: 220,
  sidebarCollapsed: false,
  secCollapsed: {},
  detailTab: "details",
  citeFormat: "bibtex",
};

const SORT_KEYS: readonly SortKey[] = ["title", "creator", "venue", "year", "lastRead", "status"];

function isBoolMap(v: unknown): v is Record<string, boolean> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => typeof x === "boolean");
}

// Unknown names and repeats drop out and the rest take the fixed column order; an empty list is a valid choice.
function sanitizeColumns(v: unknown): ColumnKey[] {
  return Array.isArray(v) ? COLUMN_KEYS.filter((key) => v.includes(key)) : [...DEFAULT_COLUMNS];
}

/** Validates each field; a missing or corrupt one falls back to its default and widths are clamped. */
export function sanitizePrefs(raw: unknown): LibraryUiPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  // A width of 0 or less stands for "never resized".
  const num = (v: unknown, fallback: number, lim: { min: number; max: number }): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(lim.max, Math.max(lim.min, v)) : fallback;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  const columns = sanitizeColumns(r["columns"]);
  const sortKey = oneOf(r["sortKey"], SORT_KEYS, d.sortKey);
  // A sort by a hidden column would order the list by something the user cannot see.
  const sortHidden = sortKey !== "title" && !columns.includes(sortKey);
  return {
    sortKey: sortHidden ? "title" : sortKey,
    sortDir: sortHidden || r["sortDir"] !== -1 ? 1 : -1,
    columns,
    detailWidth: num(r["detailWidth"], d.detailWidth, PANE_LIMITS.detail),
    detailCollapsed: bool(r["detailCollapsed"], d.detailCollapsed),
    sidebarWidth: num(r["sidebarWidth"], d.sidebarWidth, PANE_LIMITS.sidebar),
    sidebarCollapsed: bool(r["sidebarCollapsed"], d.sidebarCollapsed),
    secCollapsed: isBoolMap(r["secCollapsed"]) ? r["secCollapsed"] : { ...d.secCollapsed },
    detailTab: oneOf(r["detailTab"], DETAIL_TABS, d.detailTab),
    citeFormat: oneOf(r["citeFormat"], CITE_FORMATS, d.citeFormat),
  };
}
