/** Names inside a "/"-separated string path: base name, extension and stem, with no platform access. */

/** The last segment; empty when the path ends with a slash. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The lower-case last extension of the base name with its dot, or "" when there is none; a leading dot is not an extension. */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** The base name without its last extension; a leading dot belongs to the name. */
export function stemOf(path: string): string {
  return baseName(path).replace(/(?<=.)\.[^.]*$/, "");
}
