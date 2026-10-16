// Computes the `files` description map after one file's description is set or cleared.

/**
 * Sets (trimmed) or clears the description of one name and drops descriptions of names missing from `onDisk`.
 * @returns the new map; `{}` when no description is left, which removes the `files` key; undefined when `name` is not
 * on disk and there is a description to set
 */
export function describePaperFile(
  files: Record<string, string> | undefined,
  name: string,
  description: string,
  onDisk: readonly string[],
): Record<string, string> | undefined {
  const text = description.trim();
  if (text && !onDisk.includes(name)) { return undefined; }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(files ?? {})) {
    if (key !== name && onDisk.includes(key)) { next[key] = value; }
  }
  if (text) { next[name] = text; }
  return next;
}
