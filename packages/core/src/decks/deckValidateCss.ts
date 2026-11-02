/**
 * Asset references and CSS scanning for validateDeck: classifies a URL as skipped, unsafe or a folder path, finds CSS url() references, and finds heavy CSS declarations. Domain-private, not in the barrel.
 */

import { decodeUrlEscapes } from "../url/index.js";

export type DeckReference = { kind: "skip" } | { kind: "unsafe"; reason: string } | { kind: "path"; path: string };

export interface CssFinding { offset: number; text: string }

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** Resolves `.` and `..` segments; null when a `..` climbs above the root. */
function normaliseSegments(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}

/** Whether a relative path, query and fragment dropped, climbs above the root. */
export function escapesFolder(path: string): boolean {
  return normaliseSegments(path.replace(/[?#].*$/s, "").replace(/\\/g, "/")) === null;
}

/** Classifies a reference: data: URLs, fragments and empty values are skipped; absolute, protocol-relative, schemed and escaping ones are unsafe. */
export function classifyReference(raw: string): DeckReference {
  const url = raw.trim();
  if (url === "" || url.startsWith("#")) return { kind: "skip" };
  if (url.startsWith("//") || url.startsWith("\\\\")) return { kind: "unsafe", reason: "is protocol-relative" };
  if (url.startsWith("/") || url.startsWith("\\")) return { kind: "unsafe", reason: "is an absolute path" };
  const scheme = SCHEME.exec(url);
  if (scheme) {
    if (scheme[1]!.toLowerCase() === "data") return { kind: "skip" };
    return { kind: "unsafe", reason: `uses the ${scheme[1]!.toLowerCase()}: scheme` };
  }
  const withoutQuery = url.replace(/[?#].*$/s, "");
  const path = normaliseSegments(decodeUrlEscapes(withoutQuery).replace(/\\/g, "/"));
  if (path === null) return { kind: "unsafe", reason: "leaves the deck folder" };
  if (path === "") return { kind: "skip" };
  return { kind: "path", path };
}

/** The URLs of a srcset value, each with its offset in the value. */
export function readSrcset(value: string): CssFinding[] {
  const found: CssFinding[] = [];
  const candidate = /[^\s,][^\s]*/g;
  let expectUrl = true;
  for (let match = candidate.exec(value); match; match = candidate.exec(value)) {
    const before = value.slice(0, match.index);
    if (/,\s*$/.test(before) || before.trim() === "") expectUrl = true;
    if (!expectUrl) continue;
    let text = match[0];
    if (text.endsWith(",")) text = text.slice(0, -1);
    else expectUrl = false;
    found.push({ offset: match.index, text });
  }
  return found;
}

/** The CSS with comments replaced by spaces, keeping offsets. */
function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) => " ".repeat(comment.length));
}

const URL_FUNCTION = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))/gi;

/** Every url() in a CSS text: the offset of `url(` and the URL. */
export function findCssUrls(css: string): CssFinding[] {
  const found: CssFinding[] = [];
  const text = blankComments(css);
  URL_FUNCTION.lastIndex = 0;
  for (let match = URL_FUNCTION.exec(text); match; match = URL_FUNCTION.exec(text)) {
    if (match.index > 0 && /[\w-]/.test(text[match.index - 1]!)) continue;
    found.push({ offset: match.index, text: match[1] ?? match[2] ?? match[3] ?? "" });
  }
  return found;
}

const NAMES_FILTER = /(?:^|[\s,])filter(?=$|[\s,])/i;

/** Heavy declarations: backdrop-filter anywhere, filter inside @keyframes, transitions naming filter. Offsets are at the property name. */
export function findHeavyCss(css: string): CssFinding[] {
  const found: CssFinding[] = [];
  const text = blankComments(css);
  const keyframes: boolean[] = [];
  let segment = 0;
  let parens = 0;
  let quote: string | null = null;
  const declaration = (to: number) => {
    const colon = text.indexOf(":", segment);
    if (colon === -1 || colon >= to) return;
    const rawName = text.slice(segment, colon);
    const name = rawName.trim().toLowerCase();
    const offset = segment + rawName.length - rawName.trimStart().length;
    const value = text.slice(colon + 1, to);
    const inKeyframes = keyframes.length > 0 && keyframes[keyframes.length - 1]!;
    if (name === "backdrop-filter" || name === "-webkit-backdrop-filter") found.push({ offset, text: `${name} declaration` });
    else if (name === "filter" && inKeyframes) found.push({ offset, text: "filter declaration inside @keyframes" });
    else if ((name === "transition" || name === "transition-property") && NAMES_FILTER.test(value)) found.push({ offset, text: `${name} naming filter` });
  };
  for (let pos = 0; pos < text.length; pos++) {
    const char = text[pos]!;
    if (quote) {
      if (char === "\\") pos++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") parens++;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (parens > 0) continue;
    else if (char === "{") {
      const prelude = text.slice(segment, pos).trim();
      const parent = keyframes.length > 0 && keyframes[keyframes.length - 1]!;
      keyframes.push(parent || /^@(?:-[a-z]+-)?keyframes\b/i.test(prelude));
      segment = pos + 1;
    } else if (char === ";" || char === "}") {
      declaration(pos);
      if (char === "}") keyframes.pop();
      segment = pos + 1;
    }
  }
  declaration(text.length);
  return found;
}
