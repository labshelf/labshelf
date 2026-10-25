// Turns the stored mirror toggle and address of earlier releases into one custom resolver entry.
// Delete once no browser profile older than this release can exist.
const LEGACY_KEYS = ["enableSciHub", "sciHubMirror"] as const;

/**
 * @returns the stored settings without the old keys, plus one enabled entry when the toggle was on, or undefined when
 * the stored settings hold none of the old keys
 */
export function migrateMirrorSettings(stored: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!LEGACY_KEYS.some((key) => key in stored)) return undefined;
  const { enableSciHub, sciHubMirror, ...rest } = stored;
  const mirror = typeof sciHubMirror === "string" ? sciHubMirror.trim().replace(/\/+$/, "") : "";
  if (enableSciHub !== true || !mirror) return rest;
  const entry = { name: "Custom resolver", template: `${mirror}/{doi}`, enabled: true };
  const existing = Array.isArray(rest.customResolvers) ? rest.customResolvers : [];
  const taken = existing.some((e) => (e as { template?: unknown } | null)?.template === entry.template);
  return { ...rest, customResolvers: taken ? existing : [...existing, entry] };
}
