/**
 * The inline markup allowed inside a deck text leaf: sanitizeDeckInline rewrites any HTML to the allow-list (text, br, attribute-free
 * emphasis elements, colour spans and safe links), and safeDeckHref decides which link targets are safe. Pure; runs in Node.
 */
import { tokenizeDeckHtml, type DeckAttribute } from "./deckTokens.js";

/** Elements kept without any attribute. */
const PLAIN_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "sub", "sup", "small", "mark", "code"]);
/** Elements dropped together with their content. */
const DROPPED_TAGS = new Set(["script", "style"]);
/** Elements whose boundary becomes a line break between non-empty runs. */
const BLOCK_TAGS = new Set(["div", "p"]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);

const COLOR_PATTERNS = [/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, /^(?:rgba?|hsla?)\([0-9.,% ]*\)$/i, /^var\(--[A-Za-z0-9_-]+\)$/, /^[A-Za-z]+$/];

/** Whether a CSS colour value is one a deck colour span may carry: hex, rgb()/hsl() with plain numbers, var(--name) or a named colour. */
export function isDeckInlineColor(value: string): boolean {
  return COLOR_PATTERNS.some((pattern) => pattern.test(value));
}

/** A link target that is safe in a deck (http, https, mailto, a fragment or a relative path), trimmed, or null. */
export function safeDeckHref(href: string): string | null {
  const trimmed = href.trim();
  // As DECK013's normalisation: control characters and whitespace removed, case folded.
  const cleaned = Array.from(trimmed).filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f).join("").toLowerCase();
  if (!cleaned) return null;
  const colon = cleaned.indexOf(":");
  if (colon === -1) return trimmed;
  const delimiter = cleaned.search(/[/?#]/);
  if (delimiter !== -1 && delimiter < colon) return trimmed;
  return SAFE_SCHEMES.has(cleaned.slice(0, colon)) ? trimmed : null;
}

interface InlineElement { name: string; attributes: DeckAttribute[]; children: InlineNode[] }
type InlineNode = string | InlineElement;
const BREAK = Symbol("break");
type Part = string | typeof BREAK;

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const attribute = (element: InlineElement, name: string): string | null => element.attributes.find((candidate) => candidate.name === name)?.value ?? null;

/** The tree of the html: unmatched end tags ignored, open elements closed at the end. */
function readTree(html: string): InlineNode[] {
  const root: InlineElement = { name: "", attributes: [], children: [] };
  const stack: InlineElement[] = [root];
  for (const token of tokenizeDeckHtml(html).tokens) {
    const top = stack[stack.length - 1]!;
    if (token.kind === "text") top.children.push(token.text);
    else if (token.kind === "start") {
      const element: InlineElement = { name: token.name, attributes: token.attributes, children: [] };
      top.children.push(element);
      if (!VOID_TAGS.has(token.name) && !token.selfClosing) stack.push(element);
    } else if (token.kind === "end") {
      const at = stack.map((element) => element.name).lastIndexOf(token.name);
      if (at > 0) stack.length = at;
    }
  }
  return root.children;
}

/** The colour of a span's style, or null when it has no allowed colour. */
function spanColor(element: InlineElement): string | null {
  for (const declaration of (attribute(element, "style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1 || declaration.slice(0, colon).trim().toLowerCase() !== "color") continue;
    const value = declaration.slice(colon + 1).trim();
    return isDeckInlineColor(value) ? value : null;
  }
  return null;
}

/** Joins parts: a break is written only between non-empty runs and never twice in a row. */
function resolve(parts: Part[]): string {
  let out = "";
  let pending = false;
  for (const part of parts) {
    if (part === BREAK) pending = out.length > 0;
    else if (part) {
      out += (pending ? "<br>" : "") + part;
      pending = false;
    }
  }
  return out;
}

function partsOf(nodes: InlineNode[]): Part[] {
  const parts: Part[] = [];
  for (const node of nodes) {
    if (typeof node === "string") parts.push(escapeText(node));
    else parts.push(...elementParts(node));
  }
  return parts;
}

function elementParts(element: InlineElement): Part[] {
  const { name } = element;
  if (name === "br") return ["<br>"];
  if (DROPPED_TAGS.has(name)) return [];
  if (BLOCK_TAGS.has(name)) return [BREAK, ...partsOf(element.children), BREAK];
  const keep = PLAIN_TAGS.has(name) || name === "span" || name === "a";
  if (!keep) return partsOf(element.children);
  const inner = resolve(partsOf(element.children));
  if (!inner) return [];
  if (PLAIN_TAGS.has(name)) return [`<${name}>${inner}</${name}>`];
  if (name === "span") {
    const color = spanColor(element);
    return [color ? `<span style="color: ${escapeAttribute(color)}">${inner}</span>` : inner];
  }
  const href = safeDeckHref(attribute(element, "href") ?? "");
  return [href ? `<a href="${escapeAttribute(href)}">${inner}</a>` : inner];
}

/** Rewrites html to the deck inline allow-list; idempotent. */
export function sanitizeDeckInline(html: string): string {
  return resolve(partsOf(readTree(html)));
}
