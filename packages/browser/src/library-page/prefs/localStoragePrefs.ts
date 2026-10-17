/**
 * Stores the library page's preferences in localStorage under one key: the shared library UI prefs plus the
 * sidebar tree's expanded folders and collapsed sections. A corrupt or missing entry falls back to the defaults field by field.
 */
import { sanitizePrefs, type LibraryUiPrefs, type PrefsPort } from "@labshelf/core";

export const PREFS_KEY = "labshelf.library.prefs";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export interface PagePrefs extends PrefsPort {
  treeExpanded(): string[];
  saveTreeExpanded(paths: string[]): void;
  collapsedSections(): string[];
  saveCollapsedSections(ids: string[]): void;
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
    const next = { ...sanitizePrefs(readRaw(storage)), treeExpanded: stringsOf(readRaw(storage), "treeExpanded"), collapsedSections: stringsOf(readRaw(storage), "collapsedSections"), ...patch };
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
  };
}

function stringsOf(raw: Record<string, unknown>, field: string): string[] {
  const v = raw[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
