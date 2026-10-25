// Reads and writes an item's `anchor` attribute: a highlight, a text box on a page or a passage quote.
// CONTRACT: documents/contracts/qmd-items.md#anchors
import { base64UrlToBytes, bytesToBase64Url } from "../../encoding/index.js";

export type ItemAnchor =
  | { readonly kind: "none" }
  | { readonly kind: "highlight"; readonly annotationId: string }
  | { readonly kind: "box"; readonly page: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "quote"; readonly quote: string; readonly prefix: string; readonly suffix: string };

/** An anchor in no known form, or a known form that breaks its rules; kept verbatim. */
export interface UnknownAnchor { readonly kind: "unknown"; readonly raw: string }

export type ParsedAnchor = ItemAnchor | UnknownAnchor;

const HIGHLIGHT = /^hl:(\S+)$/;
const FRACTION = "(0(?:\\.\\d{1,4})?|1(?:\\.0{1,4})?|\\.\\d{1,4})";
const BOX = new RegExp(`^p([1-9]\\d*) box ${FRACTION} ${FRACTION} ${FRACTION} ${FRACTION}$`);
const QUOTE = /^quote:([A-Za-z0-9_-]+)$/;
const CONTEXT_LIMIT = 32;
// Fractions carry at most 4 decimals, so a sum that exceeds 1 by less than this is rounding.
const EPSILON = 1e-9;

export function parseAnchor(attr: string | undefined): ParsedAnchor {
  if (attr === undefined || attr === "") { return { kind: "none" }; }
  const highlight = HIGHLIGHT.exec(attr);
  if (highlight) { return { kind: "highlight", annotationId: highlight[1]! }; }
  const box = BOX.exec(attr);
  if (box) {
    const [page, x, y, w, h] = box.slice(1).map(Number) as [number, number, number, number, number];
    const anchor = { kind: "box", page, x, y, w, h } as const;
    return Number.isSafeInteger(page) && isValidBox(anchor) ? anchor : unknown(attr);
  }
  const quote = QUOTE.exec(attr);
  if (quote) { return parseQuote(quote[1]!) ?? unknown(attr); }
  return unknown(attr);
}

/** Throws when a box or quote breaks the contract's rules, so an invalid anchor is never written. */
export function formatAnchor(anchor: ParsedAnchor): string {
  switch (anchor.kind) {
    case "none": return "";
    case "unknown": return anchor.raw;
    case "highlight":
      if (!/^\S+$/.test(anchor.annotationId)) { throw new Error(`Anchor: invalid annotation id "${anchor.annotationId}"`); }
      return `hl:${anchor.annotationId}`;
    case "box": {
      const rounded = { ...anchor, x: round(anchor.x), y: round(anchor.y), w: round(anchor.w), h: round(anchor.h) };
      if (!Number.isSafeInteger(anchor.page) || anchor.page < 1 || !isValidBox(rounded)) {
        throw new Error(`Anchor: invalid box p${anchor.page} ${anchor.x} ${anchor.y} ${anchor.w} ${anchor.h}`);
      }
      return `p${anchor.page} box ${rounded.x} ${rounded.y} ${rounded.w} ${rounded.h}`;
    }
    case "quote":
      if (!isValidQuote(anchor)) { throw new Error(`Anchor: invalid quote (${anchor.quote.length} characters)`); }
      return `quote:${bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix })))}`;
  }
}

function isValidBox(box: { x: number; y: number; w: number; h: number }): boolean {
  const inUnit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  return inUnit(box.x) && inUnit(box.y) && inUnit(box.w) && inUnit(box.h)
    && box.w > 0 && box.h > 0 && box.x + box.w <= 1 + EPSILON && box.y + box.h <= 1 + EPSILON;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function parseQuote(encoded: string): ItemAnchor | undefined {
  try {
    const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(encoded)));
    if (typeof json !== "object" || json === null) { return undefined; }
    const { quote, prefix, suffix } = json as Record<string, unknown>;
    if (typeof quote !== "string" || typeof prefix !== "string" || typeof suffix !== "string") { return undefined; }
    const anchor = { kind: "quote", quote, prefix, suffix } as const;
    return isValidQuote(anchor) ? anchor : undefined;
  } catch {
    // An undecodable value is an unknown anchor, kept verbatim by the caller.
    return undefined;
  }
}

function isValidQuote(anchor: { quote: string; prefix: string; suffix: string }): boolean {
  return anchor.quote !== "" && anchor.prefix.length <= CONTEXT_LIMIT && anchor.suffix.length <= CONTEXT_LIMIT;
}

function unknown(raw: string): UnknownAnchor {
  return { kind: "unknown", raw };
}
