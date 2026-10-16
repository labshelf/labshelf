// Handles the popup's pdfOffer.* messages: showing an offer, attaching its PDF to the paper, and dismissing it.
import { parentDir, type ILogger } from "@labshelf/core";
import type { AttachPdfData, PdfOfferView, RuntimeMessage } from "../../platform";
import { attachPdfToPaper } from "../../capture/index";
import { listAllRecords, stagedPdf, unstagePdf, type LibraryMutations } from "../../storage";
import { broadcastChanged } from "../broadcast";
import { clearOfferBadge } from "./offerBadge";
import { dropOffer, offerById, offerForTab, type PdfOffer } from "./offerStore";

const MODULE = "pdf-offer";

type PdfOfferMessage = Extract<RuntimeMessage, { type: "pdfOffer.get" | "pdfOffer.attach" | "pdfOffer.dismiss" }>;

export interface PdfOfferDeps {
  log: ILogger;
  mutations: LibraryMutations;
  scheduleSync: (reason: string) => void;
}

export function isPdfOfferMessage(msg: RuntimeMessage): msg is PdfOfferMessage {
  return msg.type.startsWith("pdfOffer.");
}

export function handlePdfOfferMessage({ log, mutations, scheduleSync }: PdfOfferDeps, msg: PdfOfferMessage): Promise<unknown> {
  switch (msg.type) {
    case "pdfOffer.get":
      return handlePdfOfferGet(log, msg.tabId);
    case "pdfOffer.attach":
      return handlePdfOfferAttach(log, mutations, msg.offerId, scheduleSync);
    case "pdfOffer.dismiss":
      return handlePdfOfferDismiss(log, msg.offerId);
  }
}

async function retire(log: ILogger, offer: PdfOffer): Promise<void> {
  await dropOffer(offer.id);
  await unstagePdf(offer.id);
  await clearOfferBadge(log, offer.tabId);
}

/** @returns the offer for the popup's tab, or null; an offer whose paper got a PDF meanwhile is dropped */
async function handlePdfOfferGet(log: ILogger, tabId: number): Promise<PdfOfferView | null> {
  const offer = await offerForTab(tabId);
  if (!offer) {
    // An expired download offer may have left its badge here.
    await clearOfferBadge(log, tabId);
    return null;
  }
  const record = (await listAllRecords()).find((r) => r.id === offer.paperId);
  if (!record || record.hasPdf !== false) {
    await retire(log, offer);
    return null;
  }
  return {
    id: offer.id, paperId: offer.paperId, title: record.title, folder: parentDir(record.path, "/"),
    hasBytes: offer.hasBytes, source: offer.source, onThisTab: offer.tabId === tabId,
  };
}

async function handlePdfOfferAttach(
  log: ILogger, mutations: LibraryMutations, offerId: string, scheduleSync: (reason: string) => void,
): Promise<AttachPdfData> {
  const offer = await offerById(offerId);
  if (!offer) throw new Error("This PDF is no longer on offer. Open or download it again.");
  const bytes = offer.hasBytes ? await stagedPdf(offer.id) : undefined;
  if (!bytes) throw new Error("LabShelf could not download this PDF again. Attach the file from the library.");
  const { record, written } = await attachPdfToPaper(mutations, offer.paperId, bytes, { version: offer.version });
  await retire(log, offer);
  void log.log("INFO", MODULE, "offered PDF attached", { paperId: offer.paperId, url: offer.url, source: offer.source, written });
  if (written) {
    scheduleSync("pdf-offer");
    broadcastChanged("attach", offer.paperId, `PDF attached to "${record.title}"`);
  }
  return { id: offer.paperId, attached: written, ...(written ? {} : { alreadyHadPdf: true }) };
}

async function handlePdfOfferDismiss(log: ILogger, offerId: string): Promise<{ dismissed: true }> {
  const offer = await offerById(offerId);
  if (offer) {
    await retire(log, offer);
    void log.log("INFO", MODULE, "PDF offer dismissed", { paperId: offer.paperId, url: offer.url });
  }
  return { dismissed: true };
}
