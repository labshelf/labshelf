/** Reads HTML tags tolerantly with regexes: decodes entities and extracts tag attributes and absolute http(s) URLs. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML entities that show up in attribute values. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Attributes of one tag, keys lower-cased, values entity-decoded. */
export function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

/** @returns the URL resolved against `base`, or undefined for a script, blob, data or non-http(s) link */
export function absoluteHttpUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw || /^(javascript|blob|data):/i.test(raw)) return undefined;
  try {
    const url = new URL(raw.trim(), base).href;
    return /^https?:/.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}
