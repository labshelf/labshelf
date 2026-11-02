/**
 * The offset-keeping HTML tokenizer of deck.html: tokens in source order with [from, to) ranges in UTF-16 code units, and the markup problems found on the way (never thrown).
 */

export interface DeckRange { from: number; to: number }

export interface DeckParseProblem { message: string; offset: number; line: number; column: number }

export interface DeckAttribute { name: string; value: string | null; range: DeckRange; valueRange: DeckRange | null }

export type DeckToken =
  | { kind: "start"; name: string; attributes: DeckAttribute[]; selfClosing: boolean; range: DeckRange }
  | { kind: "end"; name: string; range: DeckRange }
  | { kind: "text"; text: string; raw: boolean; range: DeckRange }
  | { kind: "comment"; range: DeckRange }
  | { kind: "doctype"; range: DeckRange };

/** Elements whose content up to the matching end tag is one raw text token. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

const NAMED_REFERENCES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const REFERENCE = /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([A-Za-z][A-Za-z0-9]*));/g;

/** Decodes amp, lt, gt, quot, apos, nbsp and numeric references; unknown or invalid references stay as written. */
function decodeDeckEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(REFERENCE, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED_REFERENCES[name] ?? whole;
    const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec ?? "", 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
    return String.fromCodePoint(code);
  });
}

/** 1-based line and column of an offset; a line ends at \n, so \r\n counts as one break. */
export function deckLineColumn(text: string, offset: number): { line: number; column: number } {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let index = text.indexOf("\n"); index !== -1 && index < end; index = text.indexOf("\n", index + 1)) {
    line++;
    lineStart = index + 1;
  }
  return { line, column: end - lineStart + 1 };
}

/** Builds a problem at an offset with its line and column. */
export function createDeckProblem(text: string, offset: number, message: string): DeckParseProblem {
  return { message, offset, ...deckLineColumn(text, offset) };
}

const isWhitespace = (char: string | undefined): boolean => char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
const isLetter = (char: string | undefined): boolean => char !== undefined && /[A-Za-z]/.test(char);

interface TagScan { token: DeckToken; end: number }

/** Tokenizes deck HTML; problems cover unterminated comments, tags and quoted values and duplicate attributes. */
export function tokenizeDeckHtml(html: string): { tokens: DeckToken[]; problems: DeckParseProblem[] } {
  const tokens: DeckToken[] = [];
  const problems: DeckParseProblem[] = [];
  const problem = (offset: number, message: string) => problems.push(createDeckProblem(html, offset, message));
  let textStart = 0;
  let pos = 0;

  const flushText = (to: number) => {
    if (to > textStart) tokens.push({ kind: "text", text: decodeDeckEntities(html.slice(textStart, to)), raw: false, range: { from: textStart, to } });
  };

  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) break;
    const scan = scanMarkup(html, lt, problem);
    if (!scan) {
      pos = lt + 1;
      continue;
    }
    flushText(lt);
    tokens.push(scan.token);
    pos = scan.end;
    textStart = pos;
    if (scan.token.kind === "start" && !scan.token.selfClosing && RAW_TEXT_ELEMENTS.has(scan.token.name)) {
      const close = findRawEnd(html, pos, scan.token.name);
      if (close > pos) tokens.push({ kind: "text", text: html.slice(pos, close), raw: true, range: { from: pos, to: close } });
      pos = close;
      textStart = pos;
    }
  }
  flushText(html.length);
  return { tokens, problems };
}

/** Offset of the `</name` that ends a raw text element, or the end of the input. */
function findRawEnd(html: string, from: number, name: string): number {
  const pattern = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi");
  pattern.lastIndex = from;
  return pattern.exec(html)?.index ?? html.length;
}

/** Scans the markup construct at `<`, or null when the `<` is plain text. */
function scanMarkup(html: string, lt: number, problem: (offset: number, message: string) => void): TagScan | null {
  const next = html[lt + 1];
  if (html.startsWith("<!--", lt)) {
    const close = html.indexOf("-->", lt + 4);
    if (close === -1) {
      problem(lt, "unterminated comment");
      return { token: { kind: "comment", range: { from: lt, to: html.length } }, end: html.length };
    }
    return { token: { kind: "comment", range: { from: lt, to: close + 3 } }, end: close + 3 };
  }
  if (next === "!" || next === "?") {
    const isDoctype = html.slice(lt + 2, lt + 9).toLowerCase() === "doctype";
    const close = html.indexOf(">", lt + 2);
    const end = close === -1 ? html.length : close + 1;
    if (close === -1) problem(lt, isDoctype ? "unterminated doctype" : "unterminated comment");
    return { token: isDoctype ? { kind: "doctype", range: { from: lt, to: end } } : { kind: "comment", range: { from: lt, to: end } }, end };
  }
  if (next === "/" && isLetter(html[lt + 2])) return scanEndTag(html, lt, problem);
  if (isLetter(next)) return scanStartTag(html, lt, problem);
  return null;
}

function readName(html: string, from: number): number {
  let pos = from;
  while (pos < html.length && !isWhitespace(html[pos]) && html[pos] !== "/" && html[pos] !== ">") pos++;
  return pos;
}

function scanEndTag(html: string, lt: number, problem: (offset: number, message: string) => void): TagScan {
  const nameEnd = readName(html, lt + 2);
  const name = html.slice(lt + 2, nameEnd).toLowerCase();
  const close = html.indexOf(">", nameEnd);
  if (close === -1) {
    problem(lt, `unterminated tag </${name}>`);
    return { token: { kind: "end", name, range: { from: lt, to: html.length } }, end: html.length };
  }
  return { token: { kind: "end", name, range: { from: lt, to: close + 1 } }, end: close + 1 };
}

interface ValueScan {
  attribute: DeckAttribute;
  end: number;
  unterminated: boolean;
}

/** Scans the value of an attribute whose "=" has been passed; `pos` is the first character after it and its whitespace. */
function scanAttributeValue(html: string, pos: number, name: string, attrStart: number, problem: (offset: number, message: string) => void): ValueScan {
  const quote = html[pos];
  if (quote === '"' || quote === "'") {
    const close = html.indexOf(quote, pos + 1);
    if (close === -1) {
      problem(pos, `unterminated quoted value of attribute "${name}"`);
      const valueRange = { from: pos + 1, to: html.length };
      return { attribute: { name, value: decodeDeckEntities(html.slice(pos + 1)), range: { from: attrStart, to: html.length }, valueRange }, end: html.length, unterminated: true };
    }
    const valueRange = { from: pos + 1, to: close };
    return { attribute: { name, value: decodeDeckEntities(html.slice(pos + 1, close)), range: { from: attrStart, to: close + 1 }, valueRange }, end: close + 1, unterminated: false };
  }
  let end = pos;
  while (end < html.length && !isWhitespace(html[end]) && html[end] !== ">") end++;
  const valueRange = { from: pos, to: end };
  return { attribute: { name, value: decodeDeckEntities(html.slice(pos, end)), range: { from: attrStart, to: end }, valueRange }, end, unterminated: false };
}

function scanStartTag(html: string, lt: number, problem: (offset: number, message: string) => void): TagScan {
  const nameEnd = readName(html, lt + 1);
  const name = html.slice(lt + 1, nameEnd).toLowerCase();
  const attributes: DeckAttribute[] = [];
  const seen = new Set<string>();
  const finish = (end: number, selfClosing: boolean): TagScan => ({
    token: { kind: "start", name, attributes, selfClosing, range: { from: lt, to: end } },
    end,
  });
  let pos = nameEnd;
  while (pos < html.length) {
    const char = html[pos];
    if (isWhitespace(char)) {
      pos++;
      continue;
    }
    if (char === ">") return finish(pos + 1, false);
    if (char === "/") {
      if (html[pos + 1] === ">") return finish(pos + 2, true);
      pos++;
      continue;
    }
    const attrStart = pos;
    pos++;
    while (pos < html.length && !isWhitespace(html[pos]) && html[pos] !== "/" && html[pos] !== ">" && html[pos] !== "=") pos++;
    const attrName = html.slice(attrStart, pos).toLowerCase();
    if (seen.has(attrName)) problem(attrStart, `duplicate attribute "${attrName}"`);
    seen.add(attrName);
    let lookahead = pos;
    while (isWhitespace(html[lookahead])) lookahead++;
    if (html[lookahead] !== "=") {
      attributes.push({ name: attrName, value: null, range: { from: attrStart, to: pos }, valueRange: null });
      continue;
    }
    pos = lookahead + 1;
    while (isWhitespace(html[pos])) pos++;
    const value = scanAttributeValue(html, pos, attrName, attrStart, problem);
    attributes.push(value.attribute);
    pos = value.end;
    if (value.unterminated) return finish(html.length, false);
  }
  problem(lt, `unterminated tag <${name}>`);
  return finish(html.length, false);
}
