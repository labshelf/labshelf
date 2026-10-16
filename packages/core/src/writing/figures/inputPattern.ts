/** Matches project-relative POSIX paths against figure input patterns with `*`, `**` and `?`. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

const GLOB_CHARACTERS = /[*?]/;

/** True when the pattern names more than one possible path; a literal input names exactly one file. */
export function isGlobPattern(pattern: string): boolean {
  return GLOB_CHARACTERS.test(pattern);
}

/** A leading `./` is the same folder, so `./a.py` and `a.py` name one file. */
export function normalizeInputPath(pattern: string): string {
  return pattern.replace(/^(\.\/)+/, "");
}

function matchesSegment(pattern: string, segment: string): boolean {
  let p = 0;
  let s = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (s < segment.length) {
    if (pattern[p] === "*") {
      starAt = p++;
      resumeAt = s;
    } else if (pattern[p] === "?" || pattern[p] === segment[s]) {
      p++;
      s++;
    } else if (starAt >= 0) {
      p = starAt + 1;
      s = ++resumeAt;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") { p++; }
  return p === pattern.length;
}

function matchesSegments(pattern: readonly string[], path: readonly string[]): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined) { return path.length === 0; }
  if (head === "**") {
    return path.some((_, skipped) => matchesSegments(rest, path.slice(skipped))) || matchesSegments(rest, []);
  }
  const [segment, ...remaining] = path;
  return segment !== undefined && matchesSegment(head, segment) && matchesSegments(rest, remaining);
}

/** Whether a path relative to the project folder matches an input pattern; `*` and `?` stay within one segment and `**` spans any number of segments, including none. */
export function matchesInputPattern(pattern: string, relativePath: string): boolean {
  return matchesSegments(normalizeInputPath(pattern).split("/"), normalizeInputPath(relativePath).split("/"));
}
