/** Normalises the values of citation_* / Dublin Core / PRISM meta tags: authors, page ranges, keywords. */

export function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Normalises authors to "Given Family", whichever form the page used. */
export function authorsOf(citationAuthors: string[], dcCreators: string[], joined?: string): string[] {
  let list = citationAuthors.length ? citationAuthors : dcCreators;
  if (!list.length && joined) list = joined.split(/\s*;\s*/);
  const out: string[] = [];
  for (const raw of list) {
    const name = squash(raw);
    if (!name) continue;
    const comma = /^([^,]+),\s*(.+)$/.exec(name);
    const flipped = comma ? `${comma[2]} ${comma[1]}` : name;
    if (!out.includes(flipped)) out.push(flipped);
  }
  return out;
}

/** "45" + "56" → "45-56"; a single page stays as is. */
export function pagesOf(first: string | undefined, last: string | undefined): string | undefined {
  if (!first) return undefined;
  return last && last !== first ? `${first}-${last}` : first;
}

export function keywordsOf(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const k of v.split(/\s*[;,]\s*/)) {
      const kw = squash(k);
      if (kw && kw.length <= 80 && !out.some((x) => x.toLowerCase() === kw.toLowerCase())) out.push(kw);
    }
  }
  return out.slice(0, 20);
}
