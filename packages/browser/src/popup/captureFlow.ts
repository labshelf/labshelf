// Runs the capture, save and undo flow: inspecting the current tab, the shared "No PDF found" dialog, saving the
// draft, attaching a PDF to an already-saved copy, and undoing a save.
import { $, askNoPdf, type NoPdfChoice } from "@labshelf/core/dom";
import { errorMessage, pdfSourceLabel, type IfNoPdf, type PdfMiss } from "@labshelf/core";

import {
  sendRuntime, type AttachPdfData, type DraftView, type LibraryRef, type PdfOfferView, type PdfStatusData, type SaveOutcome,
} from "../platform";
import { folderName, parseTags } from "./format";
import { renderPaper, renderPdf, showError, showLibraryCopy, showStatus } from "./render";
import { popupState, setState } from "./popupState";
import { attachOffered, offerFits, settleOffer, showOffer } from "./offerCard";

// A paper already saved without its PDF: a PDF this tab showed or the user downloaded for it is attached in one click;
// otherwise the background searches this very page for one, and the popup offers to attach it when found.
async function showExisting(existing: LibraryRef): Promise<void> {
  showLibraryCopy(existing);
  if (existing.hasPdf) return;
  const found = popupState.offer?.hasBytes ? true : await pagePdfFound();
  if (found === undefined) return;
  showStatus(found
    ? { glyph: "warning", tone: "warn", title: "In your library — without its PDF", detail: folderName(existing.folder), open: "Open in library", attach: "Attach PDF" }
    : {
      glyph: "warning", tone: "warn", title: "In your library — without its PDF",
      detail: "No PDF on this page either — attach a file from the library.", open: "Open in library",
    });
  $("open").dataset["folder"] = existing.folder;
  $("open").dataset["paper"] = existing.id;
}

/** @returns whether the page offers a PDF, or undefined when the search failed */
async function pagePdfFound(): Promise<boolean | undefined> {
  renderPdf("searching");
  try {
    popupState.pdfStatus = await sendRuntime<PdfStatusData>({ type: "capture.findPdf", tabId: popupState.tabId });
  } catch {
    $("pdf").hidden = true;
    return undefined;
  }
  if (popupState.pdfStatus.found) renderPdf(popupState.pdfStatus);
  else $("pdf").hidden = true;
  return popupState.pdfStatus.found;
}

export async function inspect(offerReady: Promise<PdfOfferView | null>): Promise<void> {
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
    $("meta").textContent = "";
    setState("empty");
    showStatus({
      glyph: "globe", tone: "muted", title: "No paper detected on this page",
      detail: "Open the article's page or its PDF, or use the LabShelf buttons on Google Scholar.", tryAnyway: true,
    });
    return;
  }
  setState("form");
  $("save").focus();
  renderPdf("searching");
  try {
    popupState.pdfStatus = await sendRuntime<PdfStatusData>({ type: "capture.findPdf", tabId: popupState.tabId });
    renderPdf(popupState.pdfStatus);
  } catch {
    $("pdf").hidden = true;
  }
}

// The shared "No PDF found" dialog. Returns the chosen action, or undefined on
// Cancel (nothing is written). The modal-open class guards the popup height.
async function confirmNoPdf(title: string, miss: PdfMiss): Promise<NoPdfChoice | undefined> {
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
    return save("ask", true);
  }
  // "open" and "author" save too; the background then opens the page in the way or the request email, which closes the popup.
  return save(choice);
}

export async function save(ifNoPdf: IfNoPdf = "ask", retryPdf = false): Promise<void> {
  const from = $("popup").dataset["state"];

  // Case A: the search already ended with no PDF before Save was pressed — ask
  // instantly, with no round trip, and let Cancel keep the form as it is. The
  // background always carries `miss` on a miss; if it is absent, fall through to
  // the round trip, whose NoPdfData carries it.
  if (ifNoPdf === "ask" && !retryPdf && popupState.pdfStatus && !popupState.pdfStatus.found && popupState.pdfStatus.miss) {
    return confirmThen($("title").textContent ?? "", popupState.pdfStatus.miss, from);
  }

  $("error").hidden = true;
  setState("saving");
  try {
    const tags = parseTags($<HTMLInputElement>("tags").value);
    const note = $<HTMLTextAreaElement>("note").value.trim();
    const r = await sendRuntime<SaveOutcome>({
      type: "capture.save", tabId: popupState.tabId, folder: $<HTMLSelectElement>("folder").value, ifNoPdf,
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
    $("pdf").hidden = true;
    showStatus({
      glyph: "check", tone: "ok", title: `Saved to ${folderName(popupState.saved.folder)}`,
      detail: popupState.saved.pdfSource ? `PDF via ${pdfSourceLabel(popupState.saved.pdfSource)}` : "Saved without a PDF",
      open: "Open in library", undo: true,
    });
    $("open").dataset["folder"] = popupState.saved.folder;
    $("open").dataset["paper"] = popupState.saved.id;
  } catch (err) {
    if (from === "empty") {
      setState("empty");
      showStatus({ glyph: "warning", tone: "muted", title: "Nothing could be saved", detail: errorMessage(err) });
    } else {
      setState("form");
      showError(errorMessage(err));
    }
  }
}

// Popup "Attach PDF" on a library copy that had none: the background attaches the offered PDF, or the PDF it found
// for this page, to that copy.
export async function attachPdf(): Promise<void> {
  const btn = $<HTMLButtonElement>("attachPdf");
  btn.disabled = true;
  const offer = popupState.offer?.hasBytes ? popupState.offer : undefined;
  try {
    const r = offer ? await attachOffered(offer) : await sendRuntime<AttachPdfData>({ type: "capture.attachPdf", tabId: popupState.tabId });
    $("pdf").hidden = true;
    $("dismissOffer").hidden = true;
    // The paper has its PDF, so a leftover offer only keeps the badge; the next pdfOffer.get drops it anyway.
    if (!offer && r.attached) await settleOffer().catch(() => undefined);
    if (r.attached) {
      const detail = r.source ? `via ${pdfSourceLabel(r.source)}` : "";
      showStatus({ glyph: "check", tone: "ok", title: "PDF attached", detail, open: "Open in library" });
    } else if (r.alreadyHadPdf) {
      showStatus({ glyph: "check", tone: "ok", title: "Already has its PDF", detail: "", open: "Open in library" });
    } else {
      showStatus({ glyph: "warning", tone: "warn", title: "No PDF found", detail: "No PDF could be downloaded for this paper.", open: "Open in library" });
    }
  } catch (err) {
    showStatus({ glyph: "warning", tone: "warn", title: "Could not attach the PDF", detail: errorMessage(err), open: "Open in library" });
  } finally {
    btn.disabled = false;
  }
}

export async function undo(): Promise<void> {
  if (!popupState.saved) return;
  $<HTMLButtonElement>("undo").disabled = true;
  try {
    await sendRuntime({ type: "paper.remove", id: popupState.saved.id });
    popupState.saved = undefined;
    setState("form");
    if (popupState.pdfStatus) renderPdf(popupState.pdfStatus);
  } catch (err) {
    showStatus({ glyph: "warning", tone: "muted", title: "Could not remove the paper", detail: errorMessage(err), open: "Open in library" });
  } finally {
    $<HTMLButtonElement>("undo").disabled = false;
  }
}
