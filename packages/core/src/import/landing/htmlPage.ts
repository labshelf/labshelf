// Reads HTML fetched without a DOM into the RawPage shape the in-tab probe produces.
import { authorEmailMetasOf, mailtoLinksOf } from "./contacts/index.js";
import { absoluteHttpUrl, attributes, decodeEntities, metaPairs } from "./htmlTags.js";
import type { RawPage, RawPdfLink } from "./types.js";

// PLATFORM: the MV3 service worker and the terminal have no DOMParser, so a tolerant regex reader handles the few tags that matter.
/** @returns the meta tags, PDF links and viewers, DOI links and author-address evidence of an HTML document */
export function parseHtmlPage(html: string, pageUrl: string): RawPage {
  const raw: RawPage = {
    pageUrl,
    meta: metaTags(html),
    pdfLinks: pdfLinksOf(html, pageUrl).slice(0, 40),
    doiLinks: doiLinksOf(html),
    mailtoLinks: mailtoLinksOf(html),
    authorEmails: authorEmailMetasOf(html),
  };
  const documentTitle = firstNonEmptyTitle(html);
  if (documentTitle) raw.documentTitle = documentTitle;
  return raw;
}

// TRAP: IEEE Xplore's Angular shell ships `<title><!----><!----></title>` ahead of the real title.
function firstNonEmptyTitle(html: string): string {
  for (const m of html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)) {
    const text = decodeEntities(m[1]!.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim());
    if (text) return text;
  }
  return "";
}

function metaTags(html: string): Record<string, string[]> {
  const meta: Record<string, string[]> = {};
  for (const { key, value } of metaPairs(html)) {
    if (key) (meta[key] ??= []).push(value);
  }
  return meta;
}

function pdfLinksOf(html: string, pageUrl: string): RawPdfLink[] {
  const pdfLinks: RawPdfLink[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined, kind: RawPdfLink["kind"]): void => {
    const url = absoluteHttpUrl(raw, pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    pdfLinks.push({ url, kind });
  };

  for (const m of html.matchAll(/<(embed|iframe|object)\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const src = a["src"] ?? a["data"];
    if (a["type"] === "application/pdf" || (src && /\.pdf|\/pdf/i.test(src))) add(src, "embed");
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    if ((a["rel"] ?? "").toLowerCase() === "alternate" && a["type"] === "application/pdf") add(a["href"], "alternate");
  }
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) {
    const a = attributes(m[1] ?? "");
    const href = a["href"];
    if (!href) continue;
    const label = `${(m[2] ?? "").replace(/<[^>]+>/g, " ")} ${a["title"] ?? ""} ${a["aria-label"] ?? ""} ${a["class"] ?? ""}`;
    if (a["type"] === "application/pdf" || /(^|[^a-z])pdf([^a-z]|$)/i.test(label)) add(href, "labelled");
    else if (/\.pdf(?:[?#]|$)|\/pdf(?:direct|ft)?\/|\/epdf\//i.test(href)) add(href, "href");
  }
  return pdfLinks;
}

function doiLinksOf(html: string): string[] {
  return [...html.matchAll(/href\s*=\s*["']([^"']*doi\.org\/10\.[^"']+)["']/gi)]
    .map((m) => decodeEntities(m[1]!))
    .slice(0, 20);
}

/**
 * Where an interstitial page sends the browser next: a meta refresh or a scripted location change. Publishers
 * (ScienceDirect's "pdfft" page, for one) answer the PDF link with such a page instead of the file.
 * @returns Absolute redirect targets, most explicit first.
 */
export function redirectTargets(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi)) {
    const content = attributes(m[0])["content"] ?? "";
    const target = /url\s*=\s*['"]?([^'"]+)/i.exec(content)?.[1];
    const url = absoluteHttpUrl(target, pageUrl);
    if (url) out.push(url);
  }
  for (const m of html.matchAll(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.(?:replace|assign)\(\s*["']([^"']+)["']/g)) {
    const url = absoluteHttpUrl(decodeEntities(m[1] ?? m[2] ?? ""), pageUrl);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}
