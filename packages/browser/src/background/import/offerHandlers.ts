// Handles the popup's pdfOffer.* messages: showing an offer, attaching its PDF to the paper, and dismissing it.
import { deriveParentDir, type ILogger } from "@labshelf/core";
import type { AttachPdfReply, PdfOfferView, RuntimeMessage } from "../../platform";
import { attachPdfToPaper } from "../../capture/index";
import { listCachedPaperRecords, readStagedPdf, removeStagedPdf, type LibraryMutations } from "../../storage";
import { sendLibraryChanged } from "../broadcast";
import { removeOfferBadge } from "./offerBadge";
import { removeOffer, readOffer, offerForTab, type PdfOffer } from "./offerStore";

const MODULE = "pdf-offer";

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
