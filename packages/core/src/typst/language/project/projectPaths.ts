// Maps Typst path strings to project paths and back: relative to the referring file, `/` for the project root.

/** The project path a Typst path string in `fromFile` names, or undefined for a package (`@preview/…`) or a path above the root. */
export function resolveTypstPath(fromFile: string, written: string): string | undefined {
  if (written.startsWith("@")) { return undefined; }
  const parts = written.startsWith("/") ? [] : folderOf(fromFile);
  for (const part of written.split("/")) {
    if (part === "..") {
      if (parts.length === 0) { return undefined; }
      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** How a file in `fromFile`'s folder writes the project path `target`. */
export function deriveRelativeTypstPath(fromFile: string, target: string): string {
  const from = folderOf(fromFile);
  const to = target.split("/");
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) { shared++; }
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
}

/** The 0-based line `offset` is on. */
export function deriveLineNumber(text: string, offset: number): number {
  let line = 0;
  for (let at = text.indexOf("\n"); at >= 0 && at < offset; at = text.indexOf("\n", at + 1)) { line++; }
  return line;
}

function folderOf(file: string): string[] {
  return file.split("/").slice(0, -1);
}
