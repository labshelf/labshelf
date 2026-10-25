/** Splits labshelf.yaml into the settings a share syncs and the per-user keys each member's copy keeps. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

import YAML from "yaml";

// INVARIANT: id, folder, archived, trashed and shared are per user and never in this list.
export const SHARED_SETTING_KEYS = [
  "format", "main", "engine", "bibliography", "title", "figures", "values", "check", "target", "papers", "typst",
] as const;

/** Shared labshelf.yaml keys as plain JSON values. */
export type SharedSettings = Record<string, unknown>;

function readMapping(text: string): Record<string, unknown> {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) { throw new Error(`labshelf.yaml is not valid YAML: ${doc.errors[0]!.message}`); }
  const value: unknown = doc.toJS();
  if (value === null || value === undefined) { return {}; }
  if (typeof value !== "object" || Array.isArray(value)) { throw new Error("labshelf.yaml is not a mapping"); }
  return value as Record<string, unknown>;
}

/** The shared keys present in `yamlText`; throws when the text is not a YAML mapping. */
export function parseSharedSettings(yamlText: string): SharedSettings {
  const raw = readMapping(yamlText);
  return Object.fromEntries(SHARED_SETTING_KEYS.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
}

/**
 * The local labshelf.yaml with the shared keys of `shared`: a shared key absent from `shared` is removed, every other
 * key and the comments stay. A key whose value is unchanged is not rewritten, so its comments stay too.
 */
export function applySharedSettings(localYamlText: string, shared: SharedSettings): string {
  const current = readMapping(localYamlText);
  const doc = YAML.parseDocument(localYamlText);
  for (const key of SHARED_SETTING_KEYS) {
    const value = shared[key];
    if (value === undefined) { doc.delete(key); continue; }
    if (JSON.stringify(current[key]) !== JSON.stringify(value)) { doc.set(key, value); }
  }
  return doc.toString();
}
