/** Resolves the path of an `\input`-style command to a project-root-relative posix file path. */

/**
 * LaTeX resolves include paths from the directory TeX runs in, which is the project root,
 * so the including file's folder plays no part. Returns undefined for a path that is absolute,
 * leaves the project, or holds macros and so cannot be known statically.
 */
export function resolveIncludePath(path: string): string | undefined {
  if (path.startsWith("/") || /[\\#{}$]/.test(path)) { return undefined; }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") { continue; }
    if (part === "..") {
      if (parts.pop() === undefined) { return undefined; }
    } else { parts.push(part); }
  }
  const name = parts.pop();
  if (name === undefined) { return undefined; }
  return [...parts, name.includes(".") ? name : `${name}.tex`].join("/");
}
