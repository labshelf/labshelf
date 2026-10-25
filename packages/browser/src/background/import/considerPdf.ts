// Matches a PDF the user opened or downloaded to a library paper without a PDF, and offers to attach it.
import {
  formatError, fetchPdf, isPreprintServerUrl, matchPdfToPaper, type FetchedPdf, type ILogger, type PaperRecord,
} from "@labshelf/core";
import { fetchInTab } from "../../capture/tab";
import { readFirstPageText } from "../../import";
import { keepStagedPdfs, listAllRecords, stagePdf, unstagePdf } from "../../storage";
import { clearOfferBadge, showOfferBadge } from "./offerBadge";
import { saveOffer, type PdfOffer } from "./offerStore";
import { canRefetch } from "./pdfSignals";

const MODULE = "pdf-offer";

/** A PDF the browser showed or saved. */
export interface SeenPdf {
  source: PdfOffer["source"];
  url: string;
  /** The page a download started from; only it can be the article page, so tabs pass none. */
  referrer?: string | undefined;
  /** The tab showing the PDF, or for a download the tab to badge. */
  tabId: number;
}

/** @returns the offer made, or undefined when the PDF belongs to no library paper without a PDF */
export async function considerPdf(log: ILogger, seen: SeenPdf): Promise<PdfOffer | undefined> {
  const papers = (await listAllRecords()).filter((r) => r.hasPdf === false);
  if (papers.length === 0) return undefined;
  const id = crypto.randomUUID();
  const fetched = canRefetch(seen.url) ? await refetch(log, seen) : undefined;
  if (fetched) await stagePdf(id, fetched.bytes);
  const { paper, matchedBy } = await match(log, id, seen, papers, fetched);
  void log.log("INFO", MODULE, "PDF checked against the papers without one", {
    source: seen.source, url: seen.url, matchedBy, paperId: paper?.id ?? null, bytes: fetched !== undefined,
  });
  if (!paper) {
    if (fetched) await unstagePdf(id);
    return undefined;
  }
  const offer: PdfOffer = {
    id, source: seen.source, tabId: seen.tabId, url: seen.url, paperId: paper.id, title: paper.title,
    hasBytes: fetched !== undefined, at: Date.now(),
    ...(isPreprintServerUrl(fetched?.url ?? seen.url) ? { version: "preprint" as const } : {}),
  };
  const { kept, dropped } = await saveOffer(offer);
  for (const old of dropped) {
    await unstagePdf(old.id);
    if (!kept.some((k) => k.tabId === old.tabId)) await clearOfferBadge(log, old.tabId);
  }
  await keepStagedPdfs(kept.map((o) => o.id));
  await showOfferBadge(log, offer.tabId, paper.title);
  return offer;
}

// A tab's own fetch carries the cookies the tab earned (Firefox keeps them from background requests); a download
// has only the background fetch. A one-time signed address answers neither, so the match then rests on ids alone.
async function refetch(log: ILogger, seen: SeenPdf): Promise<FetchedPdf | undefined> {
  try {
    if (seen.source === "tab") {
      const shown = await fetchInTab(seen.tabId, seen.url);
      if (shown?.pdf) return shown.pdf;
    }
    const pdf = await fetchPdf(seen.url, { credentials: "include", logger: log });
    if (!pdf) void log.log("WARN", MODULE, "PDF could not be fetched again", { source: seen.source, url: seen.url });
    return pdf;
  } catch (error) {
    void log.log("WARN", MODULE, "PDF could not be fetched again", { source: seen.source, url: seen.url, error: formatError(error) });
    return undefined;
  }
}

type Match = { paper?: PaperRecord; matchedBy: "id" | "title" | "none" };

async function match(log: ILogger, id: string, seen: SeenPdf, papers: PaperRecord[], fetched: FetchedPdf | undefined): Promise<Match> {
  const pdf = { url: seen.url, referrer: seen.referrer };
  const byId = matchPdfToPaper(pdf, papers);
  if (byId) return { paper: byId, matchedBy: "id" };
  if (!fetched) return { matchedBy: "none" };
  let firstPageText: string;
  try {
    firstPageText = await readFirstPageText(id, fetched.bytes);
  } catch (error) {
    void log.log("WARN", MODULE, "page 1 of the PDF could not be read", { url: seen.url, error: formatError(error) });
    return { matchedBy: "none" };
  }
  const byTitle = matchPdfToPaper({ ...pdf, firstPageText }, papers);
  return byTitle ? { paper: byTitle, matchedBy: "title" } : { matchedBy: "none" };
}
