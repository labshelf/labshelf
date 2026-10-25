// Reads author-address evidence from HTML without a DOM: mailto links with their wording, and author e-mail meta tags.
import { parseAttributes, decodeEntities, walkMetaPairs } from "../htmlTags.js";
import type { RawAuthorEmail, RawMailto } from "../rawPage.js";

const MAX_LINKS = 20;
const WINDOW_BEFORE = 200;
const WINDOW_AFTER = 80;

function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/^[^<]*>/, " ")
      .replace(/<[^>]*>?/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

/** @returns the page's mailto links, each with the text around it, capped */
export function findMailtos(html: string): RawMailto[] {
  const links: RawMailto[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = parseAttributes(m[1] ?? "")["href"];
    if (!href || !/^mailto:/i.test(href)) continue;
    const start = m.index ?? 0;
    const before = plainText(html.slice(Math.max(0, start - 3 * WINDOW_BEFORE), start)).slice(-WINDOW_BEFORE);
    const text = plainText(m[2] ?? "");
    const after = plainText(html.slice(start + m[0].length, start + m[0].length + 3 * WINDOW_AFTER)).slice(0, WINDOW_AFTER);
    links.push({ href, text, context: `${before} ${text} ${after}` });
    if (links.length === MAX_LINKS) break;
  }
  return links;
}

/** @returns each citation_author_email meta value with the citation_author that came right before it */
export function findAuthorEmailMetas(html: string): RawAuthorEmail[] {
  const out: RawAuthorEmail[] = [];
  let name: string | undefined;
  for (const { key, value } of walkMetaPairs(html)) {
    if (key === "citation_author") name = value;
    else if (key === "citation_author_email") {
      out.push(name ? { email: value, name } : { email: value });
      name = undefined;
    }
  }
  return out;
}
