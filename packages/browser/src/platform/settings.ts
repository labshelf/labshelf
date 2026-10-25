// Reads and writes the user-facing preferences held in bx.storage.local.
// The options page edits them; the PDF search consults them (proxies, custom resolvers).
import { bx } from "./browserApi";
import {
  AUTO_COMPILE_MODES, DEFAULT_CONTACT_EMAIL, PAPERS_DIR, isCustomResolverTemplate, isRequestLanguage, deriveRequestLanguage,
  type AutoCompileMode, type CustomResolver, type LibraryProxy, type RequestLanguage,
} from "@labshelf/core";
import { migrateMirrorSettings } from "./mirrorToCustomResolver";
import { DEFAULT_SIDEBAR_SECTIONS, readSidebarSections, type SidebarSections } from "./sidebarSections";

/** Persisted user preferences. */
export interface LabShelfSettings {
  /** Contact email passed to the Unpaywall API and CrossRef User-Agent. */
  contactEmail: string;
  /** Collection the last capture went to; the popup and Scholar buttons default to it. */
  lastFolder: string;
  /** Library proxies in the order the PDF search tries them. */
  proxies: LibraryProxy[];
  /** Custom resolvers in the order the PDF search tries them; none until the user adds one. */
  customResolvers: CustomResolver[];
  /** Name signed on the email that asks an author for a copy; empty leaves the signature out. */
  requesterName: string;
  /** Affiliation signed under the name; empty leaves the line out. */
  requesterAffiliation: string;
  /** Language of that email; the browser's language until the user picks one. */
  requestLanguage: RequestLanguage;
  /** The sections the library page sidebar shows. */
  sidebarSections: SidebarSections;
  /** When a writing project's preview compiles. */
  autoCompile: AutoCompileMode;
  /** Whether a LaTeX build stops at its first error. */
  haltOnError: boolean;
}

export const SETTINGS_STORAGE_KEY = "labshelf.settings";

const DEFAULTS: LabShelfSettings = {
  contactEmail: DEFAULT_CONTACT_EMAIL,
  lastFolder: PAPERS_DIR,
  proxies: [],
  customResolvers: [],
  requesterName: "",
  requesterAffiliation: "",
  requestLanguage: "en",
  sidebarSections: DEFAULT_SIDEBAR_SECTIONS,
  autoCompile: "typing",
  haltOnError: false,
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

const textOr = (raw: unknown): string => (typeof raw === "string" ? raw : "");

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
  return {
    ...DEFAULTS,
    ...stored,
    proxies: validProxies(stored.proxies),
    customResolvers: validResolvers(stored.customResolvers),
    requesterName: textOr(stored.requesterName),
    requesterAffiliation: textOr(stored.requesterAffiliation),
    requestLanguage: isRequestLanguage(stored.requestLanguage) ? stored.requestLanguage : deriveRequestLanguage(globalThis.navigator?.language),
    sidebarSections: readSidebarSections(stored.sidebarSections),
    autoCompile: AUTO_COMPILE_MODES.find((mode) => mode === stored.autoCompile) ?? DEFAULTS.autoCompile,
    haltOnError: typeof stored.haltOnError === "boolean" ? stored.haltOnError : DEFAULTS.haltOnError,
  };
}

/**
 * Persists a partial settings patch, merging with whatever is already stored.
 */
export async function updateSettings(patch: Partial<LabShelfSettings>): Promise<void> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await bx.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
}
