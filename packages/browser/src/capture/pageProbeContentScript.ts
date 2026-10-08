/**
 * Page probe injected on demand into a tab via scripting.executeScript. It only collects raw evidence — every <meta>
 * value, PDF links and viewers, DOI links — and leaves interpretation to core's interpretPage, which runs the same
 * rules over HTML fetched without a DOM. Keeping the probe dumb keeps both paths identical.
 * It is serialized via Function.toString at inject time, so it imports only types.
 */
import type { RawPage } from "@labshelf/core";

/**
 * Inspects the page DOM and returns the raw evidence. Serialized via
 * Function.prototype.toString(), so it MUST NOT close over imported symbols
 * and may only use browser globals.
 */
export function probe(): RawPage {
  const meta: Record<string, string[]> = {};
  for (const el of Array.from(document.querySelectorAll<HTMLMetaElement>("meta[name], meta[property]"))) {
    const key = (el.getAttribute("name") ?? el.getAttribute("property") ?? "").trim().toLowerCase();
    const value = (el.content ?? "").trim();
    if (!key || !value) continue;
    (meta[key] ??= []).push(value);
  }

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

  const pageIsPdf = document.contentType === "application/pdf";
  const raw: RawPage = { pageUrl: location.href, meta, pdfLinks: pdfLinks.slice(0, 40), doiLinks };
  if (document.title.trim()) raw.documentTitle = document.title.trim();
  if (pageIsPdf) raw.pageIsPdf = true;
  return raw;
}
