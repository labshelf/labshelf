/** Names a code file's language for each listing tool, and normalises code so a copy and its source compare equal. */
import { deriveOriginHash } from "../noteLinks/index.js";

/** The languages whose functions and classes can be found by name; any other code file links by lines or as a whole. */
export type SymbolLanguage = "python" | "r" | "julia";

export interface CodeLanguage {
  /** The minted lexer and the Typst raw-block tag. */
  lexer: string;
  /** The listings `language=` value; absent when listings has no such language. */
  listings?: string;
  symbols?: SymbolLanguage;
}

const LANGUAGES: Readonly<Record<string, CodeLanguage>> = {
  py: { lexer: "python", listings: "Python", symbols: "python" },
  r: { lexer: "r", listings: "R", symbols: "r" },
  jl: { lexer: "julia", symbols: "julia" },
  m: { lexer: "matlab", listings: "Matlab" },
  c: { lexer: "c", listings: "C" },
  h: { lexer: "c", listings: "C" },
  cpp: { lexer: "cpp", listings: "C++" },
  cc: { lexer: "cpp", listings: "C++" },
  hpp: { lexer: "cpp", listings: "C++" },
  f90: { lexer: "fortran", listings: "Fortran" },
  f: { lexer: "fortran", listings: "Fortran" },
  java: { lexer: "java", listings: "Java" },
  js: { lexer: "javascript" },
  ts: { lexer: "typescript" },
  rs: { lexer: "rust" },
  go: { lexer: "go", listings: "Go" },
  sh: { lexer: "bash", listings: "bash" },
  bash: { lexer: "bash", listings: "bash" },
  sql: { lexer: "sql", listings: "SQL" },
  stan: { lexer: "stan" },
  hs: { lexer: "haskell", listings: "Haskell" },
  scala: { lexer: "scala", listings: "Scala" },
  rb: { lexer: "ruby", listings: "Ruby" },
  pl: { lexer: "perl", listings: "Perl" },
  lua: { lexer: "lua", listings: "Lua" },
  tex: { lexer: "latex", listings: "TeX" },
  yaml: { lexer: "yaml" },
  yml: { lexer: "yaml" },
  json: { lexer: "json" },
  toml: { lexer: "toml" },
};

/** The extensions of every code file LabShelf lists, without the dot; `R` is listed beside `r` for case-sensitive matches. */
export const CODE_FILE_EXTENSIONS: readonly string[] = [...Object.keys(LANGUAGES).filter((extension) => extension !== "tex"), "R"];

/** A glob of every code file LabShelf knows, for file searches and watchers. */
export const CODE_FILE_GLOB = `**/*.{${CODE_FILE_EXTENSIONS.join(",")}}`;

/** The language of a code file from its extension; undefined for a file that is not code LabShelf knows. */
export function deriveCodeLanguage(path: string): CodeLanguage | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) { return undefined; }
  return LANGUAGES[path.slice(dot + 1).toLowerCase()];
}

/**
 * The code as it is compared and hashed: LF line breaks, no trailing spaces, no blank lines around it,
 * and the indentation every line shares removed, so a method copied out of its class reads from column 0.
 */
export function normalizeCode(code: string): string {
  const lines = code.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[0] === "") { lines.shift(); }
  while (lines.length > 0 && lines[lines.length - 1] === "") { lines.pop(); }
  let shared: string | undefined;
  for (const line of lines) {
    if (line === "") { continue; }
    const indent = /^[ \t]*/.exec(line)![0];
    if (shared === undefined) { shared = indent; continue; }
    let common = 0;
    while (common < shared.length && common < indent.length && shared[common] === indent[common]) { common++; }
    shared = shared.slice(0, common);
  }
  const cut = shared?.length ?? 0;
  return lines.map((line) => line.slice(cut)).join("\n");
}

/** The hash a code link records: the first 12 hex characters of the SHA-256 of the normalised code. */
export function deriveCodeLinkHash(code: string): Promise<string> {
  return deriveOriginHash(normalizeCode(code));
}
