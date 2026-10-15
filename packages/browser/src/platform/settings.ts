// Reads and writes the user-facing preferences held in bx.storage.local.
// The options page edits them; resolvers consult them (Sci-Hub toggle, mirror).
import { bx } from "./browserApi";
import { DEFAULT_CONTACT_EMAIL, PAPERS_DIR, type LibraryProxy } from "@labshelf/core";

/** Persisted user preferences. */
export interface LabShelfSettings {
  /** When true, the capture chain consults the Sci-Hub mirror as a last resort. */
  enableSciHub: boolean;
  /** Sci-Hub mirror base URL, e.g. "https://sci-hub.se". */
  sciHubMirror: string;
  /** Contact email passed to the Unpaywall API and CrossRef User-Agent. */
  contactEmail: string;
  /** Auto-sync interval in minutes; 0 disables interval sync. */
  autoSyncMinutes: number;
  /** Collection the last capture went to; the popup and Scholar buttons default to it. */
  lastFolder: string;
  /** Library proxies in the order the PDF search tries them. */
  proxies: LibraryProxy[];
}

export const SETTINGS_STORAGE_KEY = "labshelf.settings";
export const DEFAULT_SCI_HUB_MIRROR = "https://sci-hub.se";

const DEFAULTS: LabShelfSettings = {
  enableSciHub: false,
  sciHubMirror: DEFAULT_SCI_HUB_MIRROR,
  contactEmail: DEFAULT_CONTACT_EMAIL,
  autoSyncMinutes: 15,
  lastFolder: PAPERS_DIR,
  proxies: [],
};

/** Keeps the entries of a stored proxy list that have the right shape; storage is outside the type system. */
function validProxies(raw: unknown): LibraryProxy[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    const { name, template, enabled } = (entry ?? {}) as Partial<Record<keyof LibraryProxy, unknown>>;
    return typeof name === "string" && typeof template === "string" && typeof enabled === "boolean"
      ? [{ name, template, enabled }]
      : [];
  });
}

/**
 * Reads the merged settings object (defaults overlaid with persisted values).
 * @returns LabShelfSettings
 */
export async function getSettings(): Promise<LabShelfSettings> {
  const raw = (await bx.storage.local.get(SETTINGS_STORAGE_KEY)) as Record<string, unknown>;
  const stored = (raw[SETTINGS_STORAGE_KEY] ?? {}) as Partial<LabShelfSettings>;
  return { ...DEFAULTS, ...stored, proxies: validProxies(stored.proxies) };
}

/**
 * Persists a partial settings patch, merging with whatever is already stored.
 */
export async function updateSettings(patch: Partial<LabShelfSettings>): Promise<void> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await bx.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
}
