/**
 * Declares the library UI preferences a host persists (sort, panes, folded sections, detail tab, citation style, Details pins),
 * the port it persists them through, and `sanitizePrefs`, which turns whatever storage returns into valid prefs.
 */
import { COLUMN_KEYS, DEFAULT_COLUMNS, type ListColumn } from "./columns.js";
import type { SortDir, SortColumn } from "./viewState.js";

export const DETAIL_TABS = ["details", "annotations", "notes", "related"] as const;
export type DetailsTab = (typeof DETAIL_TABS)[number];

export const CITE_FORMATS = ["bibtex", "apa", "mla", "chicago", "inText"] as const;
export type CitationFormat = (typeof CITE_FORMATS)[number];

/** An item the user pinned as a tab in the Details surface. */
export interface PinnedItem {
  kind: "paper" | "project";
  id: string;
}

export interface LibraryUiPrefs {
  sortKey: SortColumn;
  sortDir: SortDir;
  columns: ListColumn[];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  secCollapsed: Record<string, boolean>;
  detailTab: DetailsTab;
  citeFormat: CitationFormat;
  detailsPins: PinnedItem[];
}

/** Where a host keeps the prefs: localStorage in the browser, webview state in VS Code. */
export interface PrefsPort {
  load(): LibraryUiPrefs;
  save(patch: Partial<LibraryUiPrefs>): void;
}

/** The two keys the pane frame persists; a host that shows panes without the rest of the library prefs stores only these. */
export type PanePrefs = Pick<LibraryUiPrefs, "sidebarWidth" | "sidebarCollapsed">;

export interface PanePrefsPort {
  load(): PanePrefs;
  save(patch: Partial<PanePrefs>): void;
}

/** Drag limits of the sidebar; dragging below `collapseAt` hides it. */
export const PANE_LIMITS = {
  sidebar: { min: 160, max: 420, collapseAt: 110 },
} as const;

export const DEFAULT_PREFS: LibraryUiPrefs = {
  sortKey: "title",
  sortDir: 1,
  columns: DEFAULT_COLUMNS,
  sidebarWidth: 220,
  sidebarCollapsed: false,
  secCollapsed: {},
  detailTab: "details",
  citeFormat: "bibtex",
  detailsPins: [],
};

const SORT_KEYS: readonly SortColumn[] = ["title", "creator", "venue", "year", "lastRead", "status"];

function isBoolMap(v: unknown): v is Record<string, boolean> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => typeof x === "boolean");
}

// Unknown names and repeats drop out and the rest take the fixed column order; an empty list is a valid choice.
function sanitizeColumns(v: unknown): ListColumn[] {
  return Array.isArray(v) ? COLUMN_KEYS.filter((key) => v.includes(key)) : [...DEFAULT_COLUMNS];
}

// Malformed entries and repeats drop out; the rest keep the order the user pinned them in.
function sanitizePins(v: unknown): PinnedItem[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const pins: PinnedItem[] = [];
  for (const item of v) {
    const { kind, id } = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if ((kind !== "paper" && kind !== "project") || typeof id !== "string" || id === "" || seen.has(`${kind}:${id}`)) continue;
    seen.add(`${kind}:${id}`);
    pins.push({ kind, id });
  }
  return pins;
}

/** Validates each field; a missing or corrupt one falls back to its default and widths are clamped. */
export function normalizePrefs(raw: unknown): LibraryUiPrefs {
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
    sidebarWidth: num(r["sidebarWidth"], d.sidebarWidth, PANE_LIMITS.sidebar),
    sidebarCollapsed: bool(r["sidebarCollapsed"], d.sidebarCollapsed),
    secCollapsed: isBoolMap(r["secCollapsed"]) ? r["secCollapsed"] : { ...d.secCollapsed },
    detailTab: oneOf(r["detailTab"], DETAIL_TABS, d.detailTab),
    citeFormat: oneOf(r["citeFormat"], CITE_FORMATS, d.citeFormat),
    detailsPins: sanitizePins(r["detailsPins"]),
  };
}
