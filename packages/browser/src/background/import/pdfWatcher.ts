// Notices the PDFs the user downloads or opens in a tab and hands each new one to the matcher.
import type { ILogger } from "@labshelf/core";
import { bx } from "../../platform";
import { watchOfTab } from "../../capture/index";
import { removeStagedPdf } from "../../storage";
import { offerPdf } from "./offerPdf";
import { removeOfferBadge, showOfferBadge } from "./offerBadge";
import { isFirstSighting, offerForTab, removeTabOffer } from "./offerStore";
import { isPdfDownload, isPdfUrl, type FinishedDownload } from "./pdfSignals";

const MODULE = "pdf-offer";

/** The `downloads.onChanged` handler: a finished PDF download is matched, its offer badged on the active tab. */
export async function onDownloadChanged(log: ILogger, delta: { id: number; state?: { current?: string } }): Promise<void> {
  if (delta.state?.current !== "complete") return;
  const [item] = (await bx.downloads.search({ id: delta.id })) as FinishedDownload[];
  if (!item || !isPdfDownload(item)) return;
  const url = item.finalUrl || item.url;
  if (!(await isFirstSighting(url))) return;
  const [tab] = await bx.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) {
    void log.log("WARN", MODULE, "no tab to show a download's offer on", { url });
    return;
  }
  await offerPdf(log, { source: "download", url, referrer: item.referrer || undefined, tabId: tab.id });
}

/** The `tabs.onUpdated` handler for a finished load; a tab under a sign-in watch is the access tab's to handle. */
export async function onPdfTabLoaded(log: ILogger, tabId: number, url: string): Promise<void> {
  const offer = await offerForTab(tabId);
  if (offer?.source === "tab" && offer.url === url) {
    // A reload of the offered PDF resets the tab's badge in some browsers.
    await showOfferBadge(log, tabId, offer.title);
    return;
  }
  if (offer?.source === "tab") await closeTabOffer(log, tabId);
  if (!isPdfUrl(url) || (await watchOfTab(tabId))) return;
  if (!(await isFirstSighting(url))) return;
  await offerPdf(log, { source: "tab", url, tabId });
}

/** Drops the offer of a tab that left its PDF or closed. */
export async function closeTabOffer(log: ILogger, tabId: number, closed = false): Promise<void> {
  const offer = await removeTabOffer(tabId);
  if (!offer) return;
  await removeStagedPdf(offer.id);
  if (!closed) await removeOfferBadge(log, tabId);
}
