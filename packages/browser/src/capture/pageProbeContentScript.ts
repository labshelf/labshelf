// Collects raw page evidence (meta values, PDF, DOI and mailto links) inside a tab via scripting.executeScript.
// Interpretation stays in core's interpretPage, so DOM and DOM-less paths apply identical rules.
import type { RawPage } from "@labshelf/core";

export type PageMetaEvidence = Pick<RawPage, "pageUrl" | "meta" | "authorEmails" | "documentTitle" | "pageIsPdf">;
export type PageLinkEvidence = Pick<RawPage, "pdfLinks" | "doiLinks" | "mailtoLinks">;

/**
 * Each probe is serialized via Function.prototype.toString() and run in the page, so it MUST NOT close over
 * imported symbols and may only use browser globals. They are two functions because every helper has to be nested
 * inside the one that is injected, and one function would pass the length limit.
 */
export function probeMeta(): PageMetaEvidence {
  const meta: Record<string, string[]> = {};
  const authorEmails: Array<{ email: string; name?: string }> = [];
  let lastAuthor: string | undefined;
  for (const el of Array.from(document.querySelectorAll<HTMLMetaElement>("meta[name], meta[property]"))) {
    const key = (el.getAttribute("name") ?? el.getAttribute("property") ?? "").trim().toLowerCase();
    const value = (el.content ?? "").trim();
    if (!key || !value) continue;
    (meta[key] ??= []).push(value);
    if (key === "citation_author") lastAuthor = value;
    else if (key === "citation_author_email") {
      authorEmails.push(lastAuthor ? { email: value, name: lastAuthor } : { email: value });
      lastAuthor = undefined;
    }
  }
  const evidence: PageMetaEvidence = { pageUrl: location.href, meta, authorEmails };
  if (document.title.trim()) evidence.documentTitle = document.title.trim();
  if (document.contentType === "application/pdf") evidence.pageIsPdf = true;
  return evidence;
}

export function probeLinks(): PageLinkEvidence {
  const pdfLinks: Array<{ url: string; kind: "embed" | "alternate" | "labelled" | "href" }> = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined, kind: "embed" | "alternate" | "labelled" | "href"): void => {
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("blob:") || raw.startsWith("data:")) return;
    let url: string;
    try { url = new URL(raw, location.href).href; } catch { return; }
    if (!/^https?:/.test(url) || seen.has(url)) return;
    seen.add(url);
    pdfLinks.push({ url, kind });
  };

  // A PDF viewer embedded in the page is the paper itself.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(
    'embed[type="application/pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], iframe[src*="/pdf"], object[type="application/pdf"], object[data*=".pdf"]',
  ))) {
    add(el.getAttribute("src") ?? el.getAttribute("data"), "embed");
  }
  for (const el of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][type="application/pdf"]'))) {
    add(el.getAttribute("href"), "alternate");
  }
  const PDF_WORD = /(^|[^a-z])pdf([^a-z]|$)/i;
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    const label = `${a.textContent ?? ""} ${a.title} ${a.getAttribute("aria-label") ?? ""} ${a.className} ${a.getAttribute("data-track-action") ?? ""}`;
    if (a.getAttribute("type") === "application/pdf" || (PDF_WORD.test(label) && label.length < 300)) add(href, "labelled");
    else if (/\.pdf(?:[?#]|$)|\/pdf(?:direct|ft)?\/|\/epdf\/|[?&]type=printable/i.test(href)) add(href, "href");
  }

  const doiLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="doi.org/10."]'))
    .map((a) => a.href)
    .slice(0, 20);

  // Text around a mailto link: climb to an ancestor with enough words, then cut a window around the link.
  const mailtoLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:" i]')).slice(0, 20).map((a) => {
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    let block: HTMLElement = a;
    for (let i = 0; i < 4 && block.parentElement && (block.textContent ?? "").length < 280; i++) block = block.parentElement;
    const full = (block.textContent ?? "").replace(/\s+/g, " ");
    const at = Math.max(0, full.indexOf(text));
    return { href: a.getAttribute("href") ?? "", text, context: full.slice(Math.max(0, at - 200), at + text.length + 80) };
  });
  return { pdfLinks: pdfLinks.slice(0, 40), doiLinks, mailtoLinks };
}
