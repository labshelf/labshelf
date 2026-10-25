// Finds the PDF a watched tab reached: the PDF it shows, or a PDF its page offers for the same paper.
import { fetchPdf, interpretPage, isSupplementaryUrl, sameWork, type FetchedPdf, type ILogger } from "@labshelf/core";
import { fetchInTab } from "./tab";
import { probeTab } from "./tabProbe";

// Each candidate costs a request to a publisher that just let the user in; the page's first links are its best.
const MAX_CANDIDATES = 3;

/** @returns the PDF of the paper titled `title` that the tab at `url` shows or offers, or undefined when it has none yet */
export async function pdfInTab(log: ILogger, tabId: number, url: string, title: string): Promise<FetchedPdf | undefined> {
  // A supplement opened from the article is another file, not the paper.
  if (isSupplementaryUrl(url)) return undefined;
  const shown = await fetchInTab(tabId, url);
  if (shown?.pdf) return shown.pdf;
  if (!shown) {
    // PLATFORM: Firefox's PDF viewer takes no extension script; a background fetch carries the session the tab earned.
    const pdf = await fetchPdf(url, { credentials: "include", logger: log });
    if (pdf) return pdf;
  }
  const facts = interpretPage(await probeTab(log, tabId, url));
  // A page about another work (a journal's home, a citing article) must not lend its PDF to this paper.
  if (facts.metadata.title && !sameWork({ title: facts.metadata.title }, { title })) return undefined;
  const tab = { url, fetchInTab: (u: string) => fetchInTab(tabId, u) };
  for (const candidate of facts.pdfCandidates.filter((c) => !isSupplementaryUrl(c.url)).slice(0, MAX_CANDIDATES)) {
    const pdf = await fetchPdf(candidate.url, { credentials: "include", logger: log, tab });
    if (pdf) return pdf;
  }
  return undefined;
}
