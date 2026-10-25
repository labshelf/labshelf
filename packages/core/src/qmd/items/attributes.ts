// Reads and writes the attribute block of a fenced div's opening line: `::: {#id .class key="value"}`.
// CONTRACT: documents/contracts/qmd-items.md#items

export interface ItemAttributes {
  readonly id?: string;
  readonly classes: readonly string[];
  /** Key-value attributes in source order, duplicates included. */
  readonly pairs: readonly (readonly [string, string])[];
}

const OPENER = /^:{3,}[ \t]*\{(.*)\}[ \t]*:*[ \t]*$/;
const TOKEN = /\s*(?:#([^\s{}"'=]+)|\.([^\s{}"'=]+)|([A-Za-z_][\w.:-]*)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s{}"']+)))/y;

/** @returns undefined when the line is not a div opening line with one well-formed attribute block */
export function parseDivOpener(line: string): ItemAttributes | undefined {
  const opener = OPENER.exec(line);
  if (!opener) { return undefined; }
  const inner = opener[1]!;
  let id: string | undefined;
  const classes: string[] = [];
  const pairs: [string, string][] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < inner.length) {
    if (/^\s*$/.test(inner.slice(TOKEN.lastIndex))) { break; }
    const token = TOKEN.exec(inner);
    if (!token) { return undefined; }
    const [, tokenId, tokenClass, key, doubleQuoted, singleQuoted, bare] = token;
    const quoted = doubleQuoted ?? singleQuoted;
    if (tokenId !== undefined) {
      if (id !== undefined) { return undefined; }
      id = tokenId;
    } else if (tokenClass !== undefined) {
      classes.push(tokenClass);
    } else {
      pairs.push([key!, quoted !== undefined ? quoted.replace(/\\([\\"'])/g, "$1") : bare!]);
    }
  }
  return id === undefined ? { classes, pairs } : { id, classes, pairs };
}

/** Writes `::: {…}` without a line ending. Throws on a name or value that cannot be written on one line. */
export function formatDivOpener(attributes: ItemAttributes): string {
  const tokens: string[] = [];
  if (attributes.id !== undefined) { tokens.push(`#${checkName(attributes.id)}`); }
  for (const name of attributes.classes) { tokens.push(`.${checkName(name)}`); }
  for (const [key, value] of attributes.pairs) {
    if (!/^[A-Za-z_][\w.:-]*$/.test(key)) { throw new Error(`Div attribute: invalid key "${key}"`); }
    if (/[\r\n]/.test(value)) { throw new Error(`Div attribute: value of "${key}" spans lines`); }
    tokens.push(`${key}="${value.replace(/[\\"]/g, "\\$&")}"`);
  }
  return `::: {${tokens.join(" ")}}`;
}

/** The value of the first attribute named `key`. */
export function readAttribute(attributes: ItemAttributes, key: string): string | undefined {
  return attributes.pairs.find(([name]) => name === key)?.[1];
}

function checkName(name: string): string {
  if (!/^[^\s{}"'=]+$/.test(name)) { throw new Error(`Div attribute: invalid id or class "${name}"`); }
  return name;
}
