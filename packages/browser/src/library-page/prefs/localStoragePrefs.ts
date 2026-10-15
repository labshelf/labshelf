/**
 * Stores the library page's preferences in localStorage under one key: the shared library UI prefs plus the
 * sidebar tree's expanded folders. A corrupt or missing entry falls back to the defaults field by field.
 */
import { sanitizePrefs, type LibraryUiPrefs, type PrefsPort } from "@labshelf/core";

export const PREFS_KEY = "labshelf.library.prefs";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export interface PagePrefs extends PrefsPort {
  treeExpanded(): string[];
  saveTreeExpanded(paths: string[]): void;
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
    const next = { ...sanitizePrefs(readRaw(storage)), treeExpanded: treeExpandedOf(readRaw(storage)), ...patch };
    // Private windows can refuse writes; the page then works with the in-memory state only.
    try { storage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  return {
    load: () => sanitizePrefs(readRaw(storage)),
    save: (patch: Partial<LibraryUiPrefs>) => write(patch),
    treeExpanded: () => treeExpandedOf(readRaw(storage)),
    saveTreeExpanded: (paths) => write({ treeExpanded: paths }),
  };
}

function treeExpandedOf(raw: Record<string, unknown>): string[] {
  const v = raw["treeExpanded"];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
