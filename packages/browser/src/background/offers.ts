// Offers to attach a PDF the user downloads or opens to the library paper it belongs to: notices the PDF, matches it to a
// paper without one, badges the toolbar, keeps the open offers across service-worker restarts and answers the popup's
// pdfOffer.* messages.
import {
  COLOR_TOKENS, deriveParentDir, fetchPdf, formatError, isPreprintServerUrl, matchPdfToPaper,
  type FetchedPdf, type ILogger, type PaperRecord, type PdfVersion,
} from "@labshelf/core";
import { bx } from "../platform";
import type { AttachPdfReply, PdfOfferView, RuntimeMessage } from "../platform";
import { attachPdfToPaper, fetchInTab, readFirstPageText, watchOfTab } from "../capture/index";
import {
  listCachedPaperRecords, readStagedPdf, removeStagedPdf, removeStagedPdfsExcept, writeStagedPdf, type LibraryMutations,
} from "../storage";
import { sendLibraryChanged } from "./broadcast";

const MODULE = "pdf-offer";

// ----- PDF signals

/** The fields of a finished download the watcher reads; `finalUrl` is Chrome's address after redirects. */
export interface FinishedDownload {
  url: string;
  finalUrl?: string;
  referrer?: string;
  filename: string;
  mime?: string;
}

export function isPdfDownload(item: FinishedDownload): boolean {
  return item.mime?.toLowerCase() === "application/pdf" || item.filename.toLowerCase().endsWith(".pdf");
}

/** A guess from the address alone; the %PDF header of the fetched bytes is the real check. */
export function isPdfUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return /\.pdf$/i.test(path) || /\/e?pdf(\/|$)/i.test(path);
}

// blob:, data: and file: addresses belong to the page or the disk; only the web can be asked again.
export function canRefetch(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// ----- Toolbar badge

// ASCII only (no emoji in UI text); the toolbar has no theme, so the badge uses the dark values of the core tokens.
const TEXT = "PDF";
const COLOR = COLOR_TOKENS.focus.value;

async function showOfferBadge(log: ILogger, tabId: number, title: string): Promise<void> {
  try {
    await bx.action.setBadgeBackgroundColor({ tabId, color: COLOR });
    await bx.action.setBadgeText({ tabId, text: TEXT });
    await bx.action.setTitle({ tabId, title: `LabShelf — attach this PDF to "${title}"` });
  } catch (error) {
    // The tab may have closed since the PDF finished.
    void log.log("WARN", "pdf-offer", "badge not set", { tabId, error: formatError(error) });
  }
}

async function removeOfferBadge(log: ILogger, tabId: number): Promise<void> {
  try {
    // PLATFORM: null (not "") removes the tab's own value in Chrome and Firefox, so the toolbar button shows its default state again.
    await bx.action.setBadgeText({ tabId, text: null });
    await bx.action.setBadgeBackgroundColor({ tabId, color: null });
    await bx.action.setTitle({ tabId, title: null });
  } catch (error) {
    void log.log("WARN", "pdf-offer", "badge not cleared", { tabId, error: formatError(error) });
  }
}

// ----- Offer store

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

async function removeOffer(id: string): Promise<void> {
  const all = await allOffers();
  const rest = all.filter((o) => o.id !== id);
  if (rest.length !== all.length) await bx.storage.session.set({ [OFFERS]: rest });
}

/** The tab offer of `tabId`, dropped from the store; used when the tab leaves its PDF or closes. */
async function removeTabOffer(tabId: number): Promise<PdfOffer | undefined> {
  const offer = (await allOffers()).find((o) => o.tabId === tabId && o.source === "tab");
  if (offer) await removeOffer(offer.id);
  return offer;
}

/** @returns true the first time `url` is seen in this browser session */
async function isFirstSighting(url: string): Promise<boolean> {
  const seen = ((await bx.storage.session.get(SEEN))[SEEN] as string[] | undefined) ?? [];
  if (seen.includes(url)) return false;
  await bx.storage.session.set({ [SEEN]: [url, ...seen].slice(0, MAX_SEEN) });
  return true;
}

// ----- Matching a PDF to a paper

/** A PDF the browser showed or saved. */
interface SeenPdf {
  source: PdfOffer["source"];
  url: string;
  /** The page a download started from; only it can be the article page, so tabs pass none. */
  referrer?: string | undefined;
  /** The tab showing the PDF, or for a download the tab to badge. */
  tabId: number;
}

/** @returns the offer made, or undefined when the PDF belongs to no library paper without a PDF */
async function offerPdf(log: ILogger, seen: SeenPdf): Promise<PdfOffer | undefined> {
  const papers = (await listCachedPaperRecords()).filter((r) => r.hasPdf === false);
  if (papers.length === 0) return undefined;
  const id = crypto.randomUUID();
  const fetched = canRefetch(seen.url) ? await refetch(log, seen) : undefined;
  if (fetched) await writeStagedPdf(id, fetched.bytes);
  const { paper, matchedBy } = await match(log, id, seen, papers, fetched);
  void log.log("INFO", MODULE, "PDF checked against the papers without one", {
    source: seen.source, url: seen.url, matchedBy, paperId: paper?.id ?? null, bytes: fetched !== undefined,
  });
  if (!paper) {
    if (fetched) await removeStagedPdf(id);
    return undefined;
  }
  const offer: PdfOffer = {
    id, source: seen.source, tabId: seen.tabId, url: seen.url, paperId: paper.id, title: paper.title,
    hasBytes: fetched !== undefined, at: Date.now(),
    ...(isPreprintServerUrl(fetched?.url ?? seen.url) ? { version: "preprint" as const } : {}),
  };
  const { kept, dropped } = await writeOffer(offer);
  for (const old of dropped) {
    await removeStagedPdf(old.id);
    if (!kept.some((k) => k.tabId === old.tabId)) await removeOfferBadge(log, old.tabId);
  }
  await removeStagedPdfsExcept(kept.map((o) => o.id));
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

// ----- Watcher

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

// ----- The popup's messages

type PdfOfferMessage = Extract<RuntimeMessage, { type: "pdfOffer.get" | "pdfOffer.attach" | "pdfOffer.dismiss" }>;

export interface PdfOfferDeps {
  log: ILogger;
  mutations: LibraryMutations;
}

export function isPdfOfferMessage(msg: RuntimeMessage): msg is PdfOfferMessage {
  return msg.type.startsWith("pdfOffer.");
}

export function answerPdfOfferMessage({ log, mutations }: PdfOfferDeps, msg: PdfOfferMessage): Promise<unknown> {
  switch (msg.type) {
    case "pdfOffer.get":
      return handlePdfOfferGet(log, msg.tabId);
    case "pdfOffer.attach":
      return handlePdfOfferAttach(log, mutations, msg.offerId);
    case "pdfOffer.dismiss":
      return handlePdfOfferDismiss(log, msg.offerId);
  }
}

async function retire(log: ILogger, offer: PdfOffer): Promise<void> {
  await removeOffer(offer.id);
  await removeStagedPdf(offer.id);
  await removeOfferBadge(log, offer.tabId);
}

/** @returns the offer for the popup's tab, or null; an offer whose paper got a PDF meanwhile is dropped */
async function handlePdfOfferGet(log: ILogger, tabId: number): Promise<PdfOfferView | null> {
  const offer = await offerForTab(tabId);
  if (!offer) {
    // An expired download offer may have left its badge here.
    await removeOfferBadge(log, tabId);
    return null;
  }
  const record = (await listCachedPaperRecords()).find((r) => r.id === offer.paperId);
  if (!record || record.hasPdf !== false) {
    await retire(log, offer);
    return null;
  }
  return {
    id: offer.id, paperId: offer.paperId, title: record.title, folder: deriveParentDir(record.path, "/"),
    hasBytes: offer.hasBytes, source: offer.source, onThisTab: offer.tabId === tabId,
  };
}

async function handlePdfOfferAttach(
  log: ILogger, mutations: LibraryMutations, offerId: string,
): Promise<AttachPdfReply> {
  const offer = await readOffer(offerId);
  if (!offer) throw new Error("This PDF is no longer on offer. Open or download it again.");
  const bytes = offer.hasBytes ? await readStagedPdf(offer.id) : undefined;
  if (!bytes) throw new Error("LabShelf could not download this PDF again. Attach the file from the library.");
  const { record, written } = await attachPdfToPaper(mutations, offer.paperId, bytes, { version: offer.version });
  await retire(log, offer);
  void log.log("INFO", MODULE, "offered PDF attached", { paperId: offer.paperId, url: offer.url, source: offer.source, written });
  if (written) {
    sendLibraryChanged("attach", offer.paperId, `PDF attached to "${record.title}"`);
  }
  return { id: offer.paperId, attached: written, ...(written ? {} : { alreadyHadPdf: true }) };
}

async function handlePdfOfferDismiss(log: ILogger, offerId: string): Promise<{ dismissed: true }> {
  const offer = await readOffer(offerId);
  if (offer) {
    await retire(log, offer);
    void log.log("INFO", MODULE, "PDF offer dismissed", { paperId: offer.paperId, url: offer.url });
  }
  return { dismissed: true };
}
