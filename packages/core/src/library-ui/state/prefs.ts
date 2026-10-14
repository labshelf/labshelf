/**
 * The library UI preferences a host persists (sort, panes, folded sections, detail tab, citation style), the port it
 * persists them through, and `sanitizePrefs`, which turns whatever storage returns into valid prefs.
 */
import type { SortDir, SortKey } from "./viewState.js";

export const DETAIL_TABS = ["details", "annotations", "notes", "related"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export const CITE_FORMATS = ["bibtex", "apa", "mla", "chicago", "inText"] as const;
export type CiteFormat = (typeof CITE_FORMATS)[number];

export interface LibraryUiPrefs {
  sortKey: SortKey;
  sortDir: SortDir;
  includeSub: boolean;
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

/** Drag limits of the two side panes; dragging below `collapseAt` hides the pane. */
export const PANE_LIMITS = {
  sidebar: { min: 160, max: 420, collapseAt: 110 },
  detail: { min: 260, max: 760, collapseAt: 180 },
} as const;

export const DEFAULT_PREFS: LibraryUiPrefs = {
  sortKey: "title",
  sortDir: 1,
  includeSub: true,
  detailWidth: 360,
  detailCollapsed: false,
  sidebarWidth: 220,
  sidebarCollapsed: false,
  secCollapsed: {},
  detailTab: "details",
  citeFormat: "bibtex",
};

const SORT_KEYS: readonly SortKey[] = ["title", "creator", "year", "publication", "lastRead", "status"];

function isBoolMap(v: unknown): v is Record<string, boolean> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => typeof x === "boolean");
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
  return {
    sortKey: oneOf(r["sortKey"], SORT_KEYS, d.sortKey),
    sortDir: r["sortDir"] === -1 ? -1 : 1,
    includeSub: bool(r["includeSub"], d.includeSub),
    detailWidth: num(r["detailWidth"], d.detailWidth, PANE_LIMITS.detail),
    detailCollapsed: bool(r["detailCollapsed"], d.detailCollapsed),
    sidebarWidth: num(r["sidebarWidth"], d.sidebarWidth, PANE_LIMITS.sidebar),
    sidebarCollapsed: bool(r["sidebarCollapsed"], d.sidebarCollapsed),
    secCollapsed: isBoolMap(r["secCollapsed"]) ? r["secCollapsed"] : { ...d.secCollapsed },
    detailTab: oneOf(r["detailTab"], DETAIL_TABS, d.detailTab),
    citeFormat: oneOf(r["citeFormat"], CITE_FORMATS, d.citeFormat),
  };
}
