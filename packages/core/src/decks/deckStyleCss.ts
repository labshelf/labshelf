/**
 * The Style tokens of an HTML deck as a `labshelf:style` comment-delimited section of custom properties at the end of theme.css's first top-level `:root` rule.
 * Without the section the plain `--deck-*` properties of the rule give the tokens.
 */
import { DECK_STYLE_TOKENS, isDeckScale, normaliseDeckColour, normaliseDeckFont, normaliseDeckStyle, validateDeckStyle } from "./deckStyleTokens.js";
import type { DeckStyle, DeckStyleToken } from "./deckStyleTokens.js";
import { findRootRule, readDeclarations, skipOpaque, stripComments } from "./themeCss.js";
import type { RootRule } from "./themeCss.js";

/** The custom property each token is written to; `--deck-bg`, `--deck-fg`, `--deck-accent` and `--deck-font` are the names the scaffold already uses. */
export const THEME_STYLE_PROPERTIES: Readonly<Record<DeckStyleToken, string>> = {
  primary: "--deck-primary", accent: "--deck-accent", background: "--deck-bg", text: "--deck-fg", muted: "--deck-muted",
  headingFont: "--deck-heading-font", bodyFont: "--deck-font", monoFont: "--deck-mono-font", scale: "--deck-scale",
};

const OPEN_MARKER = "/* labshelf:style */";
const END_MARKER = "/* labshelf:style end */";
const OPEN_COMMENT = /^\/\*\s*labshelf:style\s*\*\/$/;
const END_COMMENT = /^\/\*\s*labshelf:style\s+end\s*\*\/$/;
const NUMBER = /^[0-9]*\.?[0-9]+$/;
const FONT_TOKENS: readonly DeckStyleToken[] = ["headingFont", "bodyFont", "monoFont"];

interface StyleBlock { from: number; to: number; text: string; innerFrom: number; innerTo: number }

/** The section inside the rule (whole lines when the markers start and end their lines); null without an opening marker; "unterminated" when the opening marker has no end. */
function findBlock(css: string, rule: RootRule): StyleBlock | "unterminated" | null {
  let open: { start: number; end: number } | null = null;
  let pos = rule.bodyFrom;
  while (pos < rule.close) {
    const skipped = skipOpaque(css, pos);
    if (skipped === pos) {
      pos++;
      continue;
    }
    if (css.startsWith("/*", pos)) {
      const comment = css.slice(pos, skipped);
      if (!open && OPEN_COMMENT.test(comment)) open = { start: pos, end: skipped };
      else if (open && END_COMMENT.test(comment)) {
        let from = open.start;
        let lineStart = from;
        while (lineStart > rule.bodyFrom && (css[lineStart - 1] === " " || css[lineStart - 1] === "\t")) lineStart--;
        if (lineStart === rule.bodyFrom || css[lineStart - 1] === "\n") from = lineStart;
        let to = skipped;
        let after = to;
        while (css[after] === " " || css[after] === "\t") after++;
        if (css[after] === "\n") to = after + 1;
        else if (css[after] === "\r" && css[after + 1] === "\n") to = after + 2;
        return { from, to, text: css.slice(from, to), innerFrom: open.end, innerTo: pos };
      }
    }
    pos = skipped;
  }
  return open ? "unterminated" : null;
}

/** Sets or clears (when the value is invalid) the token the property name stands for. */
function readToken(style: Partial<DeckStyle>, name: string, raw: string): void {
  const token = DECK_STYLE_TOKENS.find((candidate) => THEME_STYLE_PROPERTIES[candidate] === name);
  if (!token) return;
  const value = stripComments(raw).trim();
  if (token === "scale") {
    const scale = NUMBER.test(value) ? Number(value) : NaN;
    if (isDeckScale(scale)) style.scale = scale;
    else delete style.scale;
    return;
  }
  const normalised = FONT_TOKENS.includes(token) ? normaliseDeckFont(value) : normaliseDeckColour(value);
  if (normalised !== null) style[token] = normalised;
  else delete style[token];
}

/** The Style section of theme.css (range and text) and the tokens it sets; without a section the plain `--deck-*` names of the :root rule give the tokens and the block is null. */
export function readThemeStyle(css: string): { block: { from: number; to: number; text: string } | null; style: Partial<DeckStyle> } {
  const style: Partial<DeckStyle> = {};
  const rule = findRootRule(css);
  if (!rule) return { block: null, style };
  const found = findBlock(css, rule);
  const block = found && found !== "unterminated" ? found : null;
  const scope: RootRule = block ? { bodyFrom: block.innerFrom, close: block.innerTo } : rule;
  for (const declaration of readDeclarations(css, scope)) {
    if (declaration.name.startsWith("--")) readToken(style, declaration.name, css.slice(declaration.value.from, declaration.value.to));
  }
  return { block: block ? { from: block.from, to: block.to, text: block.text } : null, style };
}

function blockLines(style: DeckStyle): string[] {
  const normalised = normaliseDeckStyle(style);
  return [`  ${OPEN_MARKER}`, ...DECK_STYLE_TOKENS.map((token) => `  ${THEME_STYLE_PROPERTIES[token]}: ${normalised[token]};`), `  ${END_MARKER}`];
}

/** theme.css with the Style section written (replaced in place, appended at the end of the :root rule, or in a new :root rule at the end of the file); null for an invalid style or an opening marker without its end. */
export function setThemeStyle(css: string, style: DeckStyle): string | null {
  if (validateDeckStyle(style).length > 0) return null;
  const lines = blockLines(style);
  const rule = findRootRule(css);
  if (!rule) {
    const separator = css !== "" && !css.endsWith("\n") ? "\n" : "";
    return `${css}${separator}:root {\n${lines.join("\n")}\n}\n`;
  }
  const found = findBlock(css, rule);
  if (found === "unterminated") return null;
  if (found) {
    const first = /^\s/.test(found.text) ? lines : [lines[0]!.trimStart(), ...lines.slice(1)];
    const text = first.join("\n") + (found.text.endsWith("\n") ? "\n" : "");
    return css.slice(0, found.from) + text + css.slice(found.to);
  }
  let insertAt = rule.close;
  while (insertAt > rule.bodyFrom && /\s/.test(css[insertAt - 1]!)) insertAt--;
  const last = readDeclarations(css, rule).at(-1);
  const semicolon = last && !last.terminated ? ";" : "";
  const rest = css.slice(insertAt);
  return `${css.slice(0, insertAt)}${semicolon}\n${lines.join("\n")}${/^\r?\n/.test(rest) ? "" : "\n"}${rest}`;
}
