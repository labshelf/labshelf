// Reads HTML into evidence about a paper: tolerant tag reading without a DOM, the RawPage shape the in-tab probe also produces, and the author-address evidence on a page.
import type { DetectedIds } from "./identifiers/index.js";
import type { ResolvedMetadata } from "./registries/index.js";

/** A link or viewer on the page that may lead to the article PDF. */
interface RawPdfCandidate {
  url: string;
  /**
   * embed — a PDF viewer embedded in the page (<embed>/<iframe>/<object>);
   * alternate — <link rel="alternate" type="application/pdf">;
   * labelled — an anchor whose text, title or attributes say "PDF";
   * href — an anchor whose URL looks like a PDF.
   */
  kind: "embed" | "alternate" | "labelled" | "href";
}

/** A mailto: link with the page text around it, which tells whether it names the corresponding author. */
export interface RawMailto {
  href: string;
  /** The link's own text. */
  text: string;
  /** Up to about 200 characters of page text before the link, the link text, and about 80 after. */
  context: string;
}

/** A citation_author_email meta value and the citation_author tag that directly preceded it. */
export interface RawAuthorEmail {
  email: string;
  name?: string;
}

/** Everything a page showed, as plain JSON (it crosses the browser's scripting boundary). */
export interface RawPage {
  pageUrl: string;
  /** document.title, or the PDF viewer's title when the tab is a PDF. */
  documentTitle?: string;
  /** True when the tab is showing a PDF document itself. */
  pageIsPdf?: boolean;
  /** Lower-cased <meta name|property> → every content value, in page order. */
  meta: Record<string, string[]>;
  pdfLinks: RawPdfCandidate[];
  /** hrefs of doi.org links — publishers print the article's own DOI this way. */
  doiLinks: string[];
  /** At most 20 mailto: links, in page order. */
  mailtoLinks: RawMailto[];
  /** citation_author_email meta tags in page order, kept apart from `meta` because the pairing with authors depends on order. */
  authorEmails: RawAuthorEmail[];
}

/** A URL that may serve the paper's PDF, and who suggested it (shown to the user). */
export interface PdfCandidate {
  url: string;
  source: string;
}

export interface PageFacts {
  pageUrl: string;
  ids: DetectedIds;
  /** Fields the page itself states; empty when it states none. */
  metadata: ResolvedMetadata;
  /** True when the metadata came from structured citation tags, not just the page title. */
  structured: boolean;
  /** PDF links found on the page, most trustworthy first. */
  pdfCandidates: PdfCandidate[];
  /** The page is a scholarly work: it names an identifier, states citation tags, or is a PDF. */
  isPaper: boolean;
}

// Tolerant tag reading: regexes over the few tags that matter, with entities decoded.

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
function parseAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

/** @returns the URL resolved against `base`, or undefined for a script, blob, data or non-http(s) link */
function resolveAbsoluteHttpUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw || /^(javascript|blob|data):/i.test(raw)) return undefined;
  try {
    const url = new URL(raw.trim(), base).href;
    return /^https?:/.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** @returns each non-empty `<meta>` as its lowercased name or property and its trimmed content, in document order */
function* walkMetaPairs(html: string): Generator<{ key: string; value: string }> {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = parseAttributes(m[0]);
    const key = (a["name"] ?? a["property"] ?? "").trim().toLowerCase();
    const value = (a["content"] ?? "").trim();
    if (value) yield { key, value };
  }
}

// Author-address evidence: mailto links with their wording, and author e-mail meta tags.

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
function findMailtos(html: string): RawMailto[] {
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
function findAuthorEmailMetas(html: string): RawAuthorEmail[] {
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

// PLATFORM: the MV3 service worker and the terminal have no DOMParser, so a tolerant regex reader handles the few tags that matter.
/** @returns the meta tags, PDF links and viewers, DOI links and author-address evidence of an HTML document */
export function parseHtmlPage(html: string, pageUrl: string): RawPage {
  const raw: RawPage = {
    pageUrl,
    meta: metaTags(html),
    pdfLinks: pdfLinksOf(html, pageUrl).slice(0, 40),
    doiLinks: doiLinksOf(html),
    mailtoLinks: findMailtos(html),
    authorEmails: findAuthorEmailMetas(html),
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
  for (const { key, value } of walkMetaPairs(html)) {
    if (key) (meta[key] ??= []).push(value);
  }
  return meta;
}

function pdfLinksOf(html: string, pageUrl: string): RawPdfCandidate[] {
  const pdfLinks: RawPdfCandidate[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined, kind: RawPdfCandidate["kind"]): void => {
    const url = resolveAbsoluteHttpUrl(raw, pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    pdfLinks.push({ url, kind });
  };

  for (const m of html.matchAll(/<(embed|iframe|object)\b[^>]*>/gi)) {
    const a = parseAttributes(m[0]);
    const src = a["src"] ?? a["data"];
    if (a["type"] === "application/pdf" || (src && /\.pdf|\/pdf/i.test(src))) add(src, "embed");
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = parseAttributes(m[0]);
    if ((a["rel"] ?? "").toLowerCase() === "alternate" && a["type"] === "application/pdf") add(a["href"], "alternate");
  }
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) {
    const a = parseAttributes(m[1] ?? "");
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
export function findRedirectUrls(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi)) {
    const content = parseAttributes(m[0])["content"] ?? "";
    const target = /url\s*=\s*['"]?([^'"]+)/i.exec(content)?.[1];
    const url = resolveAbsoluteHttpUrl(target, pageUrl);
    if (url) out.push(url);
  }
  for (const m of html.matchAll(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.(?:replace|assign)\(\s*["']([^"']+)["']/g)) {
    const url = resolveAbsoluteHttpUrl(decodeEntities(m[1] ?? m[2] ?? ""), pageUrl);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}
