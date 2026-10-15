// Reads and writes the user-facing preferences held in bx.storage.local.
// The options page edits them; the PDF search consults them (proxies, custom resolvers).
import { bx } from "./browserApi";
import { DEFAULT_CONTACT_EMAIL, PAPERS_DIR, isCustomResolverTemplate, type CustomResolver, type LibraryProxy } from "@labshelf/core";
import { migrateMirrorSettings } from "./migrations";

/** Persisted user preferences. */
export interface LabShelfSettings {
  /** Contact email passed to the Unpaywall API and CrossRef User-Agent. */
  contactEmail: string;
  /** Auto-sync interval in minutes; 0 disables interval sync. */
  autoSyncMinutes: number;
  /** Collection the last capture went to; the popup and Scholar buttons default to it. */
  lastFolder: string;
  /** Library proxies in the order the PDF search tries them. */
  proxies: LibraryProxy[];
  /** Custom resolvers in the order the PDF search tries them; none until the user adds one. */
  customResolvers: CustomResolver[];
}

export const SETTINGS_STORAGE_KEY = "labshelf.settings";

const DEFAULTS: LabShelfSettings = {
  contactEmail: DEFAULT_CONTACT_EMAIL,
  autoSyncMinutes: 15,
  lastFolder: PAPERS_DIR,
  proxies: [],
  customResolvers: [],
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

/** Keeps the entries of a stored custom resolver list whose template is usable. */
function validResolvers(raw: unknown): CustomResolver[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    const { name, template, enabled } = (entry ?? {}) as Partial<Record<keyof CustomResolver, unknown>>;
    return typeof name === "string" && typeof template === "string" && typeof enabled === "boolean" && isCustomResolverTemplate(template)
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
  let stored = (raw[SETTINGS_STORAGE_KEY] ?? {}) as Record<string, unknown>;
  const migrated = migrateMirrorSettings(stored);
  if (migrated) {
    stored = migrated;
    await bx.storage.local.set({ [SETTINGS_STORAGE_KEY]: stored });
  }
  return { ...DEFAULTS, ...stored, proxies: validProxies(stored.proxies), customResolvers: validResolvers(stored.customResolvers) };
}

/**
 * Persists a partial settings patch, merging with whatever is already stored.
 */
export async function updateSettings(patch: Partial<LabShelfSettings>): Promise<void> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await bx.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
}
