// Renders the popup form's DOM: paper title/byline, PDF status line, folder select, the shared
// status banner (used for the library copy, errors and the saved confirmation), and textarea auto-grow.
import { findElement } from "@labshelf/core/dom";
import { escapeHtml, renderIcon, type IconName } from "@labshelf/core";

import type { DraftView, LibraryReference, FindPdfReply } from "../platform";
import { formatFolderName, formatMetaLine } from "./format";
import { describePdfLine } from "../ui";
import { popupState, showPopupView } from "./popupState";

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
