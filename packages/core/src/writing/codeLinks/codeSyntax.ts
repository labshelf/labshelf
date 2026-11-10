/** Parses and formats the comments that enclose a code listing copied from a file: `% labshelf:code <path>[#<anchor>] @<hash>` … `% labshelf:code end`. */
// CONTRACT: documents/contracts/library-format.md#code-listings

/** What part of the file the listing copies: the whole file, a function or class by its dotted name, or lines (1-based, inclusive). */
export type CodeAnchor =
  | { kind: "file" }
  | { kind: "symbol"; name: string }
  | { kind: "lines"; start: number; end: number };

export interface CodeLinkRef {
  /** POSIX path relative to the project folder; may climb out of it with `../`. */
  path: string;
  anchor: CodeAnchor;
  hash: string;
}

export type ManuscriptFormat = "latex" | "typst";

const BEGIN = /^\s*(?:%|\/\/)\s*labshelf:code\s+(\S+)\s+@([0-9a-f]{12})\s*$/;
const END = /^\s*(?:%|\/\/)\s*labshelf:code\s+end\s*$/;
const LINES = /^L(\d+)-L(\d+)$/;
const SYMBOL = /^[^\s#@]+$/;

/** Spaces, `#` and `%` in a path are percent-encoded, so the path stays one word and never looks like an anchor. */
const encodePath = (path: string): string => path.replace(/%/g, "%25").replace(/ /g, "%20").replace(/#/g, "%23");
const decodePath = (path: string): string => path.replace(/%20/g, " ").replace(/%23/g, "#").replace(/%25/g, "%");

function parseAnchor(text: string | undefined): CodeAnchor | undefined {
  if (text === undefined) { return { kind: "file" }; }
  const lines = LINES.exec(text);
  if (lines) {
    const start = Number(lines[1]);
    const end = Number(lines[2]);
    return start >= 1 && end >= start ? { kind: "lines", start, end } : undefined;
  }
  return SYMBOL.test(text) ? { kind: "symbol", name: text } : undefined;
}

export function formatAnchor(anchor: CodeAnchor): string {
  switch (anchor.kind) {
    case "file": return "";
    case "symbol": return `#${anchor.name}`;
    case "lines": return `#L${anchor.start}-L${anchor.end}`;
  }
}

/** The link a line's opening comment names, or undefined when the line is not one or is malformed. */
export function parseCodeLinkBegin(line: string): CodeLinkRef | undefined {
  const match = BEGIN.exec(line.replace(/\r$/, ""));
  if (!match) { return undefined; }
  const target = match[1]!;
  const hashAt = target.indexOf("#");
  const path = decodePath(hashAt < 0 ? target : target.slice(0, hashAt));
  const anchor = parseAnchor(hashAt < 0 ? undefined : target.slice(hashAt + 1));
  if (path === "" || !anchor) { return undefined; }
  return { path, anchor, hash: match[2]! };
}

export function isCodeLinkEnd(line: string): boolean {
  return END.test(line.replace(/\r$/, ""));
}

export function formatCodeLinkBegin(format: ManuscriptFormat, ref: CodeLinkRef): string {
  return `${format === "latex" ? "%" : "//"} labshelf:code ${encodePath(ref.path)}${formatAnchor(ref.anchor)} @${ref.hash}`;
}

export function formatCodeLinkEnd(format: ManuscriptFormat): string {
  return `${format === "latex" ? "%" : "//"} labshelf:code end`;
}
