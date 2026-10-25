// Runs the capture, save and undo flow: inspecting the current tab, the shared "No PDF found" dialog, saving the
// draft, attaching a PDF to an already-saved copy, and undoing a save.
import { findElement, askNoPdf, type MissingPdfChoice } from "@labshelf/core/dom";
import { formatError, formatPdfSourceLabel, type MissingPdfAction, type PdfMiss } from "@labshelf/core";

import {
  sendRuntime, type AttachPdfReply, type DraftView, type LibraryReference, type PdfOfferView, type FindPdfReply, type WriteOutcome,
} from "../platform";
import { formatFolderName, parseTags } from "./format";
import { renderPaper, renderPdf, showError, showLibraryCopy, showNotice } from "./render";
import { popupState, setState } from "./popupState";
import { attachOffered, offerFits, attachOffer, showOffer } from "./offerCard";

// A paper already saved without its PDF: a PDF this tab showed or the user downloaded for it is attached in one click;
// otherwise the background searches this very page for one, and the popup offers to attach it when found.
async function showExisting(existing: LibraryReference): Promise<void> {
  showLibraryCopy(existing);
  if (existing.hasPdf) return;
  const found = popupState.offer?.hasBytes ? true : await pagePdfFound();
  if (found === undefined) return;
  showNotice(found
    ? { glyph: "warning", tone: "warn", title: "In your library — without its PDF", detail: formatFolderName(existing.folder), open: "Open in library", attach: "Attach PDF" }
    : {
      glyph: "warning", tone: "warn", title: "In your library — without its PDF",
      detail: "No PDF on this page either — attach a file from the library.", open: "Open in library",
    });
  findElement("open").dataset["folder"] = existing.folder;
  findElement("open").dataset["paper"] = existing.id;
}

/** @returns whether the page offers a PDF, or undefined when the search failed */
async function pagePdfFound(): Promise<boolean | undefined> {
  renderPdf("searching");
  try {
    popupState.pdfStatus = await sendRuntime<FindPdfReply>({ type: "capture.findPdf", tabId: popupState.tabId });
  } catch {
    findElement("pdf").hidden = true;
    return undefined;
  }
  if (popupState.pdfStatus.found) renderPdf(popupState.pdfStatus);
  else findElement("pdf").hidden = true;
  return popupState.pdfStatus.found;
}

export async function detectCapture(offerReady: Promise<PdfOfferView | null>): Promise<void> {
  const draft = await sendRuntime<DraftView>({ type: "capture.inspect", tabId: popupState.tabId });
  const offer = (await offerReady) ?? undefined;
  if (draft.existing) {
    // An offer for this very paper joins the library copy's card rather than adding a second one.
    if (offer?.paperId === draft.existing.id) popupState.offer = offer;
    renderPaper(draft);
    await showExisting(draft.existing);
    return;
  }
  if (offerFits(offer, draft.isPaper)) {
    showOffer(offer);
    return;
  }
  renderPaper(draft);
  if (!draft.isPaper) {
    findElement("meta").textContent = "";
    setState("empty");
    showNotice({
      glyph: "globe", tone: "muted", title: "No paper detected on this page",
      detail: "Open the article's page or its PDF, or use the LabShelf buttons on Google Scholar.", tryAnyway: true,
    });
    return;
  }
  setState("form");
  findElement("save").focus();
  renderPdf("searching");
  try {
    popupState.pdfStatus = await sendRuntime<FindPdfReply>({ type: "capture.findPdf", tabId: popupState.tabId });
    renderPdf(popupState.pdfStatus);
  } catch {
    findElement("pdf").hidden = true;
  }
}

// The shared "No PDF found" dialog. Returns the chosen action, or undefined on
// Cancel (nothing is written). The modal-open class guards the popup height.
async function confirmNoPdf(title: string, miss: PdfMiss): Promise<MissingPdfChoice | undefined> {
  document.body.classList.add("modal-open");
  try {
    return await askNoPdf(title, miss);
  } finally {
    document.body.classList.remove("modal-open");
  }
}

async function confirmThen(title: string, miss: PdfMiss, from: string | undefined): Promise<void> {
  const choice = await confirmNoPdf(title, miss);
  if (choice === undefined) return;                // Cancel: nothing was written
  if (choice === "retry") {
    popupState.pdfStatus = undefined;
    if (from !== "empty") setState("form");
    renderPdf("searching");
    return writeCapture("ask", true);
  }
  // "open" and "author" save too; the background then opens the page in the way or the request email, which closes the popup.
  return writeCapture(choice);
}

export async function writeCapture(ifNoPdf: MissingPdfAction = "ask", retryPdf = false): Promise<void> {
  const from = findElement("popup").dataset["state"];

  // Case A: the search already ended with no PDF before Save was pressed — ask
  // instantly, with no round trip, and let Cancel keep the form as it is. The
  // background always carries `miss` on a miss; if it is absent, fall through to
  // the round trip, whose NoPdfData carries it.
  if (ifNoPdf === "ask" && !retryPdf && popupState.pdfStatus && !popupState.pdfStatus.found && popupState.pdfStatus.miss) {
    return confirmThen(findElement("title").textContent ?? "", popupState.pdfStatus.miss, from);
  }

  findElement("error").hidden = true;
  setState("saving");
  try {
    const tags = parseTags(findElement<HTMLInputElement>("tags").value);
    const note = findElement<HTMLTextAreaElement>("note").value.trim();
    const r = await sendRuntime<WriteOutcome>({
      type: "capture.save", tabId: popupState.tabId, folder: findElement<HTMLSelectElement>("folder").value, ifNoPdf,
      ...(tags.length ? { tags } : {}), ...(note ? { note } : {}), ...(retryPdf ? { retryPdf } : {}),
    });
    if (r.status === "no-pdf") {
      // Case B: Save was pressed while the search was still running; it has now
      // ended empty. Nothing was written — ask before anything is.
      popupState.pdfStatus = { found: false, miss: r.miss };
      setState(from === "empty" ? "empty" : "form");
      renderPdf(popupState.pdfStatus);
      return confirmThen(r.title, r.miss, from);
    }
    popupState.saved = r;
    setState("saved");
    findElement("pdf").hidden = true;
    showNotice({
      glyph: "check", tone: "ok", title: `Saved to ${formatFolderName(popupState.saved.folder)}`,
      detail: popupState.saved.pdfSource ? `PDF via ${formatPdfSourceLabel(popupState.saved.pdfSource)}` : "Saved without a PDF",
      open: "Open in library", undo: true,
    });
    findElement("open").dataset["folder"] = popupState.saved.folder;
    findElement("open").dataset["paper"] = popupState.saved.id;
  } catch (err) {
    if (from === "empty") {
      setState("empty");
      showNotice({ glyph: "warning", tone: "muted", title: "Nothing could be saved", detail: formatError(err) });
    } else {
      setState("form");
      showError(formatError(err));
    }
  }
}

// Popup "Attach PDF" on a library copy that had none: the background attaches the offered PDF, or the PDF it found
// for this page, to that copy.
export async function attachPdf(): Promise<void> {
  const btn = findElement<HTMLButtonElement>("attachPdf");
  btn.disabled = true;
  const offer = popupState.offer?.hasBytes ? popupState.offer : undefined;
  try {
    const r = offer ? await attachOffered(offer) : await sendRuntime<AttachPdfReply>({ type: "capture.attachPdf", tabId: popupState.tabId });
    findElement("pdf").hidden = true;
    findElement("dismissOffer").hidden = true;
    // The paper has its PDF, so a leftover offer only keeps the badge; the next pdfOffer.get drops it anyway.
    if (!offer && r.attached) await attachOffer().catch(() => undefined);
    if (r.attached) {
      const detail = r.source ? `via ${formatPdfSourceLabel(r.source)}` : "";
      showNotice({ glyph: "check", tone: "ok", title: "PDF attached", detail, open: "Open in library" });
    } else if (r.alreadyHadPdf) {
      showNotice({ glyph: "check", tone: "ok", title: "Already has its PDF", detail: "", open: "Open in library" });
    } else {
      showNotice({ glyph: "warning", tone: "warn", title: "No PDF found", detail: "No PDF could be downloaded for this paper.", open: "Open in library" });
    }
  } catch (err) {
    showNotice({ glyph: "warning", tone: "warn", title: "Could not attach the PDF", detail: formatError(err), open: "Open in library" });
  } finally {
    btn.disabled = false;
  }
}

export async function removeCapture(): Promise<void> {
  if (!popupState.saved) return;
  findElement<HTMLButtonElement>("undo").disabled = true;
  try {
    await sendRuntime({ type: "paper.remove", id: popupState.saved.id });
    popupState.saved = undefined;
    setState("form");
    if (popupState.pdfStatus) renderPdf(popupState.pdfStatus);
  } catch (err) {
    showNotice({ glyph: "warning", tone: "muted", title: "Could not remove the paper", detail: formatError(err), open: "Open in library" });
  } finally {
    findElement<HTMLButtonElement>("undo").disabled = false;
  }
}
