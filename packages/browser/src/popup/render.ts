// Renders the popup form: the popup session state and its data-state view toggle, text formatting (byline, tags, folder name, PDF line), and the paper, PDF status, folder select, notice banner and textarea DOM.
import { findElement } from "@labshelf/core/dom";
import { escapeHtml, renderIcon, type IconName, PAPERS_DIR, formatFolderPathLabel, formatAuthors, normalizeTags, formatVenueLine, formatPdfSourceLabel } from "@labshelf/core";
import type { DraftView, LibraryReference, FindPdfReply, FoldersReply, PdfOfferView, WrittenPaperReply } from "../platform";

export function showNotice(opts: {
  glyph: IconName; tone: "ok" | "muted" | "warn"; title: string; detail: string;
  open?: string; attach?: string; dismiss?: string; undo?: boolean; tryAnyway?: boolean;
}): void {
  const glyph = findElement("statusIcon");
  glyph.innerHTML = renderIcon(opts.glyph);
  glyph.dataset["tone"] = opts.tone;
  findElement("statusTitle").textContent = opts.title;
  findElement("statusDetail").textContent = opts.detail;
  findElement("statusDetail").hidden = !opts.detail;
  const open = findElement<HTMLButtonElement>("open");
  open.hidden = !opts.open;
  open.innerHTML = `${renderIcon("library")}<span>${escapeHtml(opts.open ?? "")}</span>`;
  const attach = findElement<HTMLButtonElement>("attachPdf");
  attach.hidden = !opts.attach;
  attach.innerHTML = `${renderIcon("paperclip")}<span>${escapeHtml(opts.attach ?? "")}</span>`;
  const dismiss = findElement<HTMLButtonElement>("dismissOffer");
  dismiss.hidden = !opts.dismiss;
  dismiss.textContent = opts.dismiss ?? "";
  findElement("undo").hidden = !opts.undo;
  findElement("tryAnyway").hidden = !opts.tryAnyway;
}

export function renderPaper(d: DraftView): void {
  findElement("title").textContent = d.title || "Untitled";
  findElement("title").classList.remove("muted");
  findElement("meta").textContent = formatMetaLine(d);
}

export function renderPdf(status: FindPdfReply | "searching"): void {
  const el = findElement("pdf");
  el.hidden = false;
  if (status === "searching") {
    el.dataset["tone"] = "muted";
    el.innerHTML = `<span class="spin">${renderIcon("refresh")}</span><span>${escapeHtml(describePdfLine("searching"))}</span>`;
  } else if (status.found) {
    el.dataset["tone"] = "ok";
    el.innerHTML = `${renderIcon("file-text")}<span>${escapeHtml(describePdfLine(status))}</span>`;
  } else {
    el.dataset["tone"] = "warn";
    el.innerHTML = `${renderIcon("warning")}<span>${escapeHtml(describePdfLine(status))}</span>`;
  }
}

export function renderFolders(): void {
  const select = findElement<HTMLSelectElement>("folder");
  select.innerHTML = "";
  for (const f of popupState.folders.folders) {
    const option = document.createElement("option");
    option.value = f.path;
    // <option> cannot be indented, so nesting reads as a path ("Thesis / Chapter 2").
    option.textContent = formatFolderName(f.path);
    select.append(option);
  }
  select.value = popupState.folders.lastFolder;
}

export function showLibraryCopy(existing: LibraryReference): void {
  showPopupView("library");
  if (existing.hasPdf) {
    showNotice({ glyph: "check", tone: "ok", title: "Already in your library", detail: formatFolderName(existing.folder), open: "Open in library" });
  } else {
    showNotice({ glyph: "warning", tone: "warn", title: "In your library — without its PDF", detail: formatFolderName(existing.folder), open: "Open in library" });
  }
  findElement("open").dataset["folder"] = existing.folder;
  findElement("open").dataset["paper"] = existing.id;
}

export function showError(message: string): void {
  const el = findElement("error");
  el.innerHTML = `${renderIcon("warning")}<span></span>`;
  el.querySelector("span")!.textContent = message;
  el.hidden = false;
}

export function updateTextAreaHeight(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  area.style.height = `${Math.min(area.scrollHeight, 96)}px`;
}

export type PopupState = "loading" | "form" | "library" | "empty" | "saving" | "saved";

export const popupState: {
  tabId: number;
  folders: FoldersReply;
  saved: WrittenPaperReply | undefined;
  pdfStatus: FindPdfReply | undefined;
  /** A PDF this tab showed, or the latest download, that matched a paper without a PDF. */
  offer: PdfOfferView | undefined;
} = {
  tabId: -1,
  folders: { folders: [{ path: PAPERS_DIR, depth: 0 }], lastFolder: PAPERS_DIR },
  saved: undefined,
  pdfStatus: undefined,
  offer: undefined,
};

export function showPopupView(state: PopupState): void {
  findElement("popup").dataset["state"] = state;
  findElement("form").hidden = !(state === "form" || state === "saving");
  findElement("status").hidden = !(state === "library" || state === "empty" || state === "saved");
  const busy = state === "saving";
  for (const id of ["folder", "tags", "note", "save"]) findElement<HTMLInputElement>(id).disabled = busy;
  // While searching, pdfStatus is undefined; Save then waits on the search.
  findElement("save").innerHTML = busy
    ? `<span class="spin">${renderIcon("refresh")}</span><span>${popupState.pdfStatus ? "Saving…" : "Looking for the PDF…"}</span>`
    : `<span>Save to LabShelf</span>`;
}

/** "Edelman et al. · SIAM J. Matrix Anal. Appl. · 1998" — surnames, et al. past two. */
export function formatMetaLine(d: Pick<DraftView, "authors" | "venue" | "year">): string {
  return [formatAuthors(d.authors), formatVenueLine({ journal: d.venue, year: d.year })].filter(Boolean).join(" · ");
}

/** "ml, #Thesis ch2 , ML" → ["ml", "Thesis ch2"]: split on , and ;, a leading # dropped, then normalised. */
export function parseTags(text: string): string[] {
  return normalizeTags(text.split(/[,;]/).map((raw) => raw.trim().replace(/^#/, "")));
}

/** The folder's display name: its path inside the library ("Thesis / Chapter 2"), "All papers" for the root. */
export function formatFolderName(path: string): string {
  return formatFolderPathLabel(PAPERS_DIR, path, "/");
}

/** The status line while searching, when found, and when the search ended empty (the user is asked before saving). */
export function describePdfLine(status: FindPdfReply | "searching"): string {
  if (status === "searching") return "Looking for the PDF…";
  if (status.found) return `PDF found · ${formatPdfSourceLabel(status.source)}`;
  const tried = status.miss?.tried ?? 0;
  if (tried > 0) {
    const links = tried === 1 ? "link" : "links";
    return `No PDF found (tried ${tried} ${links}) — you'll be asked before saving`;
  }
  return "No PDF found — you'll be asked before saving";
}
