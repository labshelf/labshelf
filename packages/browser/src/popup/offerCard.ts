// Shows the offer to attach a PDF the user opened or downloaded to the library paper it matched, and acts on it.
import { $ } from "@labshelf/core/dom";
import { errorMessage } from "@labshelf/core";
import { sendRuntime, type AttachPdfData, type PdfOfferView } from "../platform";
import { folderName } from "./format";
import { showStatus } from "./render";
import { popupState, setState } from "./popupState";

export function fetchOffer(tabId: number): Promise<PdfOfferView | null> {
  return sendRuntime<PdfOfferView | null>({ type: "pdfOffer.get", tabId }).catch(() => null);
}

/** Whether the offer takes the popup over the page's save form: it was made on this tab, or the page holds no paper. */
export function offerFits(offer: PdfOfferView | undefined, pageIsPaper: boolean): offer is PdfOfferView {
  return offer !== undefined && (offer.onThisTab || !pageIsPaper);
}

export function showOffer(offer: PdfOfferView): void {
  popupState.offer = offer;
  $("title").textContent = offer.title;
  $("title").classList.remove("muted");
  $("meta").textContent = folderName(offer.folder);
  $("pdf").hidden = true;
  setState("library");
  const what = offer.source === "download" ? "The PDF you downloaded" : "This PDF";
  if (offer.hasBytes) {
    showStatus({
      glyph: "paperclip", tone: "warn", title: `Attach to ${offer.title}`,
      detail: `${what} matches this paper, which has no PDF in your library yet.`, attach: "Attach PDF", dismiss: "Not this paper",
    });
  } else {
    showStatus({
      glyph: "warning", tone: "warn", title: "In your library — without its PDF",
      detail: `${what} matches this paper, but LabShelf could not download the file again. Use "Attach PDF…" in the library.`,
      open: "Open in library", dismiss: "Not this paper",
    });
  }
  $("open").dataset["folder"] = offer.folder;
  $("open").dataset["paper"] = offer.paperId;
}

export function attachOffered(offer: PdfOfferView): Promise<AttachPdfData> {
  return sendRuntime<AttachPdfData>({ type: "pdfOffer.attach", offerId: offer.id });
}

/** Clears the offer once its paper has a PDF some other way, so the toolbar badge goes too. */
export async function settleOffer(): Promise<void> {
  if (!popupState.offer) return;
  await sendRuntime({ type: "pdfOffer.dismiss", offerId: popupState.offer.id });
  popupState.offer = undefined;
}

export async function dismissOffer(): Promise<void> {
  try {
    await settleOffer();
    window.close();
  } catch (err) {
    showStatus({ glyph: "warning", tone: "muted", title: "Could not dismiss the offer", detail: errorMessage(err) });
  }
}
