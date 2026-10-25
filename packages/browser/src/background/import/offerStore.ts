// Keeps the open "attach this PDF" offers and the PDF addresses already looked at, across service-worker restarts.
import type { PdfVersion } from "@labshelf/core";
import { bx } from "../../platform";

/** A PDF the user opened or downloaded that matched a library paper without a PDF. */
export interface PdfOffer {
  id: string;
  source: "tab" | "download";
  /** The tab whose toolbar badge shows the offer. */
  tabId: number;
  url: string;
  paperId: string;
  title: string;
  version?: PdfVersion;
  /** The bytes are staged; without them the paper can only be opened in the library. */
  hasBytes: boolean;
  at: number;
}

// PLATFORM: an MV3 service worker sleeps after about 30 s idle; session storage outlives it and is cleared with the
// browser, together with the tab ids the offers name.
const OFFERS = "pdfOffers";
const SEEN = "pdfOfferSeen";
const MAX_OFFERS = 3;
const MAX_SEEN = 50;
// A download has no tab of its own, so its offer shows in any tab's popup for a while.
const DOWNLOAD_OFFER_MS = 10 * 60_000;

async function allOffers(): Promise<PdfOffer[]> {
  return ((await bx.storage.session.get(OFFERS))[OFFERS] as PdfOffer[] | undefined) ?? [];
}

/** Stores `offer` as the newest; a tab keeps one offer, and only the latest download's offer stays. */
export async function writeOffer(offer: PdfOffer): Promise<{ kept: PdfOffer[]; dropped: PdfOffer[] }> {
  const others = (await allOffers()).filter((o) => o.id !== offer.id);
  const replaced = (o: PdfOffer): boolean => o.tabId === offer.tabId || (offer.source === "download" && o.source === "download");
  const kept = [offer, ...others.filter((o) => !replaced(o))].slice(0, MAX_OFFERS);
  await bx.storage.session.set({ [OFFERS]: kept });
  return { kept, dropped: others.filter((o) => !kept.includes(o)) };
}

/** The offer badged on this tab, else the latest download's offer while it is recent. */
export async function offerForTab(tabId: number, now = Date.now()): Promise<PdfOffer | undefined> {
  const all = await allOffers();
  return all.find((o) => o.tabId === tabId && (o.source === "tab" || now - o.at < DOWNLOAD_OFFER_MS))
    ?? all.find((o) => o.source === "download" && now - o.at < DOWNLOAD_OFFER_MS);
}

export async function readOffer(id: string): Promise<PdfOffer | undefined> {
  return (await allOffers()).find((o) => o.id === id);
}

export async function removeOffer(id: string): Promise<void> {
  const all = await allOffers();
  const rest = all.filter((o) => o.id !== id);
  if (rest.length !== all.length) await bx.storage.session.set({ [OFFERS]: rest });
}

/** The tab offer of `tabId`, dropped from the store; used when the tab leaves its PDF or closes. */
export async function removeTabOffer(tabId: number): Promise<PdfOffer | undefined> {
  const offer = (await allOffers()).find((o) => o.tabId === tabId && o.source === "tab");
  if (offer) await removeOffer(offer.id);
  return offer;
}

/** @returns true the first time `url` is seen in this browser session */
export async function isFirstSighting(url: string): Promise<boolean> {
  const seen = ((await bx.storage.session.get(SEEN))[SEEN] as string[] | undefined) ?? [];
  if (seen.includes(url)) return false;
  await bx.storage.session.set({ [SEEN]: [url, ...seen].slice(0, MAX_SEEN) });
  return true;
}
