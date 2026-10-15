// Renders the popup form's DOM: paper title/byline, PDF status line, folder select, the shared
// status banner (used for the library copy, errors and the saved confirmation), and textarea auto-grow.
import { $ } from "@labshelf/core/dom";
import { escapeHtml, icon, type IconName } from "@labshelf/core";

import type { DraftView, LibraryRef, PdfStatusData } from "../platform";
import { folderName, metaLine } from "./format";
import { pdfLineText } from "../ui";
import { popupState, setState } from "./state";

export function showStatus(opts: { glyph: IconName; tone: "ok" | "muted" | "warn"; title: string; detail: string; open?: string; attach?: string; undo?: boolean; tryAnyway?: boolean }): void {
  const glyph = $("statusIcon");
  glyph.innerHTML = icon(opts.glyph);
  glyph.dataset["tone"] = opts.tone;
  $("statusTitle").textContent = opts.title;
  $("statusDetail").textContent = opts.detail;
  $("statusDetail").hidden = !opts.detail;
  const open = $<HTMLButtonElement>("open");
  open.hidden = !opts.open;
  open.innerHTML = `${icon("library")}<span>${escapeHtml(opts.open ?? "")}</span>`;
  const attach = $<HTMLButtonElement>("attachPdf");
  attach.hidden = !opts.attach;
  attach.innerHTML = `${icon("paperclip")}<span>${escapeHtml(opts.attach ?? "")}</span>`;
  $("undo").hidden = !opts.undo;
  $("tryAnyway").hidden = !opts.tryAnyway;
}

export function renderPaper(d: DraftView): void {
  $("title").textContent = d.title || "Untitled";
  $("title").classList.remove("muted");
  $("meta").textContent = metaLine(d);
}

export function renderPdf(status: PdfStatusData | "searching"): void {
  const el = $("pdf");
  el.hidden = false;
  if (status === "searching") {
    el.dataset["tone"] = "muted";
    el.innerHTML = `<span class="spin">${icon("refresh")}</span><span>${escapeHtml(pdfLineText("searching"))}</span>`;
  } else if (status.found) {
    el.dataset["tone"] = "ok";
    el.innerHTML = `${icon("file-text")}<span>${escapeHtml(pdfLineText(status))}</span>`;
  } else {
    el.dataset["tone"] = "warn";
    el.innerHTML = `${icon("warning")}<span>${escapeHtml(pdfLineText(status))}</span>`;
  }
}

export function renderFolders(): void {
  const select = $<HTMLSelectElement>("folder");
  select.innerHTML = "";
  for (const f of popupState.folders.folders) {
    const option = document.createElement("option");
    option.value = f.path;
    // <option> cannot be indented, so nesting reads as a path ("Thesis / Chapter 2").
    option.textContent = folderName(f.path, popupState.folders);
    select.append(option);
  }
  select.value = popupState.folders.lastFolder;
}

export function showLibraryCopy(existing: LibraryRef): void {
  setState("library");
  if (existing.hasPdf) {
    showStatus({ glyph: "check", tone: "ok", title: "Already in your library", detail: folderName(existing.folder, popupState.folders), open: "Open in library" });
  } else {
    showStatus({ glyph: "warning", tone: "warn", title: "In your library — without its PDF", detail: folderName(existing.folder, popupState.folders), open: "Open in library" });
  }
  $("open").dataset["folder"] = existing.folder;
  $("open").dataset["paper"] = existing.id;
}

export function showError(message: string): void {
  const el = $("error");
  el.innerHTML = `${icon("warning")}<span></span>`;
  el.querySelector("span")!.textContent = message;
  el.hidden = false;
}

export function autoGrow(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  area.style.height = `${Math.min(area.scrollHeight, 96)}px`;
}
