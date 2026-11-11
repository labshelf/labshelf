// Reads a numbered table of a paper from its LaTeX source: the tabular of the Nth captioned table environment.

const RULES = /\\(?:hline|toprule|midrule|bottomrule|addlinespace|endhead|endfirsthead|endfoot|endlastfoot)\b(?:\[[^\]]*\])?|\\(?:cline|cmidrule)(?:\([^)]*\))?\{[^}]*\}/g;
const WRAPPERS = ["textbf", "emph", "textit", "textrm", "textsf", "underline"];

/** The index of the brace that closes the group opened at `open`, or -1. */
function closeBrace(tex: string, open: number): number {
  let depth = 0;
  for (let i = open; i < tex.length; i++) {
    const char = tex[i];
    if (char === "\\") { i++; continue; }
    if (char === "{") { depth++; }
    else if (char === "}" && --depth === 0) { return i; }
  }
  return -1;
}

/** Reads `{…}` groups (skipping whitespace and one optional `[…]` before each) from `at`; null when one is missing. */
function readGroups(tex: string, at: number, count: number): { groups: string[]; end: number } | null {
  const groups: string[] = [];
  let i = at;
  while (groups.length < count) {
    while (/\s/.test(tex[i] ?? "")) { i++; }
    if (tex[i] === "[") {
      const close = tex.indexOf("]", i);
      if (close < 0) { return null; }
      i = close + 1;
      continue;
    }
    if (tex[i] !== "{") { return null; }
    const close = closeBrace(tex, i);
    if (close < 0) { return null; }
    groups.push(tex.slice(i + 1, close));
    i = close + 1;
  }
  return { groups, end: i };
}

function stripComments(tex: string): string {
  return tex.replace(/(^|[^\\])%.*$/gm, "$1");
}

/** Splits at `separator` outside braces; `\\` and `\&` are never separators. */
function splitTopLevel(text: string, separator: "\\\\" | "&"): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (separator === "\\\\" && depth === 0 && text.startsWith("\\\\", i)) {
      parts.push(text.slice(start, i));
      i += 2;
      const spacing = /^\s*\[[^\]]*\]/.exec(text.slice(i));
      if (spacing) { i += spacing[0].length; }
      start = i;
      i--;
      continue;
    }
    if (char === "\\") { i++; continue; }
    if (char === "{") { depth++; }
    else if (char === "}") { depth--; if (depth < 0) { return null; } }
    else if (char === "&" && separator === "&" && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  if (depth !== 0) { return null; }
  parts.push(text.slice(start));
  return parts;
}

/** Unwraps `\textbf{x}` and friends; null when a group does not close. */
function unwrap(cell: string): string | null {
  let text = cell;
  for (const name of WRAPPERS) {
    for (let at = text.indexOf(`\\${name}{`); at >= 0; at = text.indexOf(`\\${name}{`)) {
      const open = at + name.length + 1;
      const close = closeBrace(text, open);
      if (close < 0) { return null; }
      text = text.slice(0, at) + text.slice(open + 1, close) + text.slice(close + 1);
    }
  }
  return text;
}

function cleanCell(cell: string): string | null {
  const unwrapped = unwrap(cell);
  if (unwrapped === null) { return null; }
  return unwrapped.replace(/\\([%&#_])/g, "$1").replace(/(^|[^\\])~/g, "$1 ").replace(/\s+/g, " ").trim();
}

/** Expands `\multicolumn{n}{spec}{x}` and `\multirow{n}{w}{x}` to x, with n-1 empty cells after a multicolumn. */
function expandCell(cell: string): string[] | null {
  const trimmed = cell.trim();
  const multi = /^\\(multicolumn|multirow)\s*/.exec(trimmed);
  if (!multi) {
    const clean = cleanCell(trimmed);
    return clean === null ? null : [clean];
  }
  const read = readGroups(trimmed, multi[0].length, 3);
  if (!read || trimmed.slice(read.end).trim() !== "") { return null; }
  const [count, , content = ""] = read.groups;
  const inner = expandCell(content);
  if (!inner || inner.length !== 1) { return null; }
  const span = multi[1] === "multicolumn" ? Number(count) : 1;
  if (!Number.isSafeInteger(span) || span < 1) { return null; }
  return [inner[0]!, ...new Array<string>(span - 1).fill("")];
}

/** Finds the body of the first tabular, tabularx or tabular* in `env`. */
function tabularBody(env: string): string | null {
  const begin = /\\begin\{(tabular\*?|tabularx)\}/.exec(env);
  if (!begin) { return null; }
  const name = begin[1]!;
  const read = readGroups(env, begin.index + begin[0].length, name === "tabular" ? 1 : 2);
  if (!read) { return null; }
  const end = env.indexOf(`\\end{${name}}`, read.end);
  if (end < 0) { return null; }
  const body = env.slice(read.end, end);
  return /\\begin\{tabular/.test(body) ? null : body;
}

/** The table environments that carry a caption, in source order. */
function captionedTables(tex: string): string[] {
  const out: string[] = [];
  const begin = /\\begin\{(table\*?)\}/g;
  for (let m = begin.exec(tex); m; m = begin.exec(tex)) {
    const end = tex.indexOf(`\\end{${m[1]}}`, m.index);
    if (end < 0) { break; }
    const env = tex.slice(m.index, end);
    if (/\\caption\b/.test(env)) { out.push(env); }
    begin.lastIndex = end;
  }
  return out;
}

/**
 * Reads the table printed as "Table <label>" from a paper's flattened LaTeX: the Nth `table` or `table*` environment
 * with a `\caption`, its first tabular. Rules are dropped, `\multicolumn` is unwrapped and padded, `\textbf` and
 * `\emph` are unwrapped, inline math stays as written.
 * @returns the rows, header first, or null for a label that is not a plain integer or anything that does not parse.
 */
export function tableFromTabular(tex: string, label: string): string[][] | null {
  if (!/^\d+$/.test(label)) { return null; }
  const env = captionedTables(stripComments(tex))[Number(label) - 1];
  const body = env === undefined ? null : tabularBody(env);
  if (body === null) { return null; }
  const lines = splitTopLevel(body.replace(RULES, " ").replace(/\\tabularnewline\b/g, "\\\\"), "\\\\");
  if (!lines) { return null; }
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.trim() === "") { continue; }
    const cells = splitTopLevel(line, "&");
    if (!cells) { return null; }
    const row: string[] = [];
    for (const cell of cells) {
      const expanded = expandCell(cell);
      if (!expanded) { return null; }
      row.push(...expanded);
    }
    rows.push(row);
  }
  const columns = Math.max(0, ...rows.map((r) => r.length));
  if (rows.length < 2 || columns < 2) { return null; }
  return rows.map((r) => [...r, ...new Array<string>(columns - r.length).fill("")]);
}
