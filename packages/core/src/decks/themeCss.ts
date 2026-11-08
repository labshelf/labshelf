/**
 * Reads and writes the custom properties of the first top-level `:root` rule of a deck's theme.css, keeping every other byte.
 */
import type { DeckRange } from "./deckTokens.js";

export interface ThemeProperty { name: string; value: string; range: DeckRange }

export interface RootRule { bodyFrom: number; close: number }

export interface Declaration { name: string; value: DeckRange; end: number; terminated: boolean }

const PROPERTY_NAME = /^--[A-Za-z0-9_-]+$/;
const isWhitespace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);

/** Offset just past the comment or string starting at `pos`, or `pos` when none starts there. */
export function skipOpaque(css: string, pos: number): number {
  if (css.startsWith("/*", pos)) {
    const close = css.indexOf("*/", pos + 2);
    return close === -1 ? css.length : close + 2;
  }
  const quote = css[pos];
  if (quote !== '"' && quote !== "'") return pos;
  let index = pos + 1;
  while (index < css.length && css[index] !== quote && css[index] !== "\n") index += css[index] === "\\" ? 2 : 1;
  return Math.min(index + 1, css.length);
}

/** Offset of the `}` matching the `{` at `open`, or css.length when unterminated. */
function findBlockEnd(css: string, open: number): number {
  let depth = 0;
  let pos = open;
  while (pos < css.length) {
    const skipped = skipOpaque(css, pos);
    if (skipped !== pos) {
      pos = skipped;
      continue;
    }
    if (css[pos] === "{") depth++;
    else if (css[pos] === "}" && --depth === 0) return pos;
    pos++;
  }
  return css.length;
}

export const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?(\*\/|$)/g, "");

/** The first top-level rule whose selector, comments removed and trimmed, is exactly `:root`. */
export function findRootRule(css: string): RootRule | null {
  let pos = 0;
  let preludeStart = 0;
  let atRule = false;
  while (pos < css.length) {
    const skipped = skipOpaque(css, pos);
    if (skipped !== pos) {
      pos = skipped;
      continue;
    }
    const char = css[pos];
    if (char === "@" && stripComments(css.slice(preludeStart, pos)).trim() === "") atRule = true;
    if (char === ";" && atRule) {
      atRule = false;
      preludeStart = pos + 1;
    } else if (char === "}") {
      preludeStart = pos + 1;
    } else if (char === "{") {
      const close = findBlockEnd(css, pos);
      if (!atRule && stripComments(css.slice(preludeStart, pos)).trim() === ":root") return { bodyFrom: pos + 1, close };
      atRule = false;
      pos = close + 1;
      preludeStart = pos;
      continue;
    }
    pos++;
  }
  return null;
}

/** The declarations of a rule body, split on `;` outside comments, strings and nested blocks. */
export function readDeclarations(css: string, rule: RootRule): Declaration[] {
  const declarations: Declaration[] = [];
  let from = rule.bodyFrom;
  let colon = -1;
  let depth = 0;
  const finish = (to: number, terminated: boolean) => {
    const content = stripComments(css.slice(from, to)).trim();
    if (content !== "") {
      const name = colon === -1 ? content : stripComments(css.slice(from, colon)).trim();
      let start = colon === -1 ? to : colon + 1;
      let end = to;
      while (start < end && isWhitespace(css[start])) start++;
      while (end > start && isWhitespace(css[end - 1])) end--;
      declarations.push({ name: colon === -1 ? "" : name, value: { from: start, to: end }, end, terminated });
    }
    from = to + 1;
    colon = -1;
  };
  let pos = rule.bodyFrom;
  while (pos < rule.close) {
    const skipped = skipOpaque(css, pos);
    if (skipped !== pos) {
      pos = skipped;
      continue;
    }
    const char = css[pos];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if ((char === ")" || char === "]" || char === "}") && depth > 0) depth--;
    else if (depth === 0 && char === ":" && colon === -1) colon = pos;
    else if (depth === 0 && char === ";") finish(pos, true);
    pos++;
  }
  finish(rule.close, false);
  return declarations;
}

/** The custom properties of the first `:root` rule in source order, duplicates kept; [] without one. */
export function readThemeProperties(css: string): ThemeProperty[] {
  const rule = findRootRule(css);
  if (!rule) return [];
  return readDeclarations(css, rule)
    .filter((declaration) => declaration.name.startsWith("--"))
    .map((declaration) => ({ name: declaration.name, value: css.slice(declaration.value.from, declaration.value.to), range: declaration.value }));
}

/** Sets one custom property in the first `:root` rule (appending it, or the rule, when missing); throws RangeError for a bad name or value. */
export function setThemeProperty(css: string, name: string, value: string): string {
  if (!PROPERTY_NAME.test(name)) throw new RangeError(`Invalid theme property name: ${name}`);
  if (value === "" || /[;{}]/.test(value)) throw new RangeError(`Invalid theme property value: ${value}`);
  const rule = findRootRule(css);
  if (!rule) {
    const separator = css !== "" && !css.endsWith("\n") ? "\n" : "";
    return `${css}${separator}:root {\n  ${name}: ${value};\n}\n`;
  }
  const declarations = readDeclarations(css, rule);
  const existing = [...declarations].reverse().find((declaration) => declaration.name === name);
  if (existing) return css.slice(0, existing.value.from) + value + css.slice(existing.value.to);
  let insertAt = rule.close;
  while (insertAt > rule.bodyFrom && isWhitespace(css[insertAt - 1])) insertAt--;
  const last = declarations[declarations.length - 1];
  const semicolon = last && !last.terminated ? ";" : "";
  return `${css.slice(0, insertAt)}${semicolon}\n  ${name}: ${value};\n${css.slice(insertAt)}`;
}
