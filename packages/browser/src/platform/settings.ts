// Reads and writes the user-facing preferences held in bx.storage.local, with the sidebar sections setting and the migration
// of the old mirror keys. The options page edits them; the PDF search consults them (proxies, custom resolvers).
import { bx } from "./bx";
import {
  AUTO_COMPILE_MODES, DEFAULT_CONTACT_EMAIL, PAPERS_DIR, isCustomResolverTemplate, isRequestLanguage, deriveRequestLanguage,
  type BuildSchedule, type CustomResolver, type LibraryProxy, type RequestLanguage,
} from "@labshelf/core";

/** Which sidebar sections the library page shows; at least one is always on. */
export interface SidebarSections {
  library: boolean;
  projects: boolean;
}

export const DEFAULT_SIDEBAR_SECTIONS: SidebarSections = { library: true, projects: true };

/** Reads a stored value; storage is outside the type system, so anything unreadable shows both sections. */
export function readSidebarSections(raw: unknown): SidebarSections {
  const { library, projects } = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof SidebarSections, unknown>>;
  const next = {
    library: typeof library === "boolean" ? library : DEFAULT_SIDEBAR_SECTIONS.library,
    projects: typeof projects === "boolean" ? projects : DEFAULT_SIDEBAR_SECTIONS.projects,
  };
  return next.library || next.projects ? next : DEFAULT_SIDEBAR_SECTIONS;
}

/** Sets one section; turning off the last visible one leaves the choice as it was. */
export function withSidebarSection(current: SidebarSections, section: keyof SidebarSections, on: boolean): SidebarSections {
  const next = { ...current, [section]: on };
  return next.library || next.projects ? next : current;
}

/** Persisted user preferences. */
export interface ExtensionSettings {
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
  autoCompile: BuildSchedule;
  /** Whether a LaTeX build stops at its first error. */
  haltOnError: boolean;
}

export const SETTINGS_STORAGE_KEY = "labshelf.settings";

const DEFAULTS: ExtensionSettings = {
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
export async function readSettings(): Promise<ExtensionSettings> {
  const raw = (await bx.storage.local.get(SETTINGS_STORAGE_KEY)) as Record<string, unknown>;
  let stored = (raw[SETTINGS_STORAGE_KEY] ?? {}) as Record<string, unknown>;
  const migrated = deriveMirrorSettings(stored);
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
export async function updateSettings(patch: Partial<ExtensionSettings>): Promise<void> {
  const current = await readSettings();
  const next = { ...current, ...patch };
  await bx.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
}

// Turns the stored mirror toggle and address of earlier releases into one custom resolver entry.
// Delete once no browser profile older than this release can exist.
const LEGACY_KEYS = ["enableSciHub", "sciHubMirror"] as const;

/**
 * @returns the stored settings without the old keys, plus one enabled entry when the toggle was on, or undefined when
 * the stored settings hold none of the old keys
 */
export function deriveMirrorSettings(stored: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!LEGACY_KEYS.some((key) => key in stored)) return undefined;
  const { enableSciHub, sciHubMirror, ...rest } = stored;
  const mirror = typeof sciHubMirror === "string" ? sciHubMirror.trim().replace(/\/+$/, "") : "";
  if (enableSciHub !== true || !mirror) return rest;
  const entry = { name: "Custom resolver", template: `${mirror}/{doi}`, enabled: true };
  const existing = Array.isArray(rest.customResolvers) ? rest.customResolvers : [];
  const taken = existing.some((e) => (e as { template?: unknown } | null)?.template === entry.template);
  return { ...rest, customResolvers: taken ? existing : [...existing, entry] };
}
