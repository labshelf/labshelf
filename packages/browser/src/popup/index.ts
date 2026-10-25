// Saves the paper on the current tab from the toolbar popup.
// States (data-state on #popup): loading, form | library | empty, saving, saved. A matched PDF offer shows as library.
import { bx, createBrowserLogger, sendRuntime } from "../platform";
import type { FoldersReply } from "../platform";
import { findElement } from "@labshelf/core/dom";
import { mountSourceBanner } from "../library/libraryLocation";
import { applyTheme } from "../ui";
import { formatError, renderIcon } from "@labshelf/core";
import { renderFolders, showNotice, updateTextAreaHeight } from "./render";
import { attachPdf, detectCapture, writeCapture, removeCapture } from "./captureFlow";
import { closeOffer, fetchOffer, showOffer } from "./offerCard";
import { popupState, setState } from "./popupState";

function wire(): void {
  findElement("form").addEventListener("submit", (e) => { e.preventDefault(); void writeCapture(); });
  const note = findElement<HTMLTextAreaElement>("note");
  note.addEventListener("input", () => updateTextAreaHeight(note));
  note.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void writeCapture(); }
  });
  findElement("tryAnyway").addEventListener("click", () => { void writeCapture(); });
  findElement("attachPdf").addEventListener("click", () => { void attachPdf(); });
  findElement("dismissOffer").addEventListener("click", () => { void closeOffer(); });
  findElement("undo").addEventListener("click", () => { void removeCapture(); });
  findElement("open").addEventListener("click", () => {
    const { folder, paper } = findElement("open").dataset;
    void sendRuntime({ type: "library.open", ...(folder ? { folder } : {}), ...(paper ? { paperId: paper } : {}) }).then(() => window.close());
  });
  findElement("library").addEventListener("click", () => {
    void sendRuntime({ type: "library.open" }).then(() => window.close());
  });
  findElement("settings").addEventListener("click", () => { void bx.runtime.openOptionsPage(); window.close(); });
}

async function init(): Promise<void> {
  applyTheme();
  findElement("brand").innerHTML = `${renderIcon("logo")}<span>LabShelf</span>`;
  findElement("library").innerHTML = renderIcon("library");
  findElement("settings").innerHTML = renderIcon("gear");
  findElement("folderIcon").innerHTML = renderIcon("folder");
  findElement("folderChevron").innerHTML = renderIcon("chevron-down");
  findElement("tagsIcon").innerHTML = renderIcon("tag");
  findElement("noteIcon").innerHTML = renderIcon("message");
  findElement("undo").innerHTML = renderIcon("trash");
  findElement("title").classList.add("muted");
  setState("loading");
  wire();
  mountSourceBanner(findElement("sourceBanner"), { logger: createBrowserLogger(), onFolder: () => undefined });

  const [tab] = await bx.tabs.query({ active: true, currentWindow: true });
  // A PDF downloaded from any page, or opened from disk, can still match a paper; the offer then fills the popup.
  const offerReady = tab?.id !== undefined ? fetchOffer(tab.id) : Promise.resolve(null);
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) {
    const offer = await offerReady;
    if (offer) {
      showOffer(offer);
      return;
    }
    findElement("title").textContent = "Nothing to save here";
    setState("empty");
    showNotice({ glyph: "globe", tone: "muted", title: "This page can't be saved", detail: "Open an article's page or its PDF in a normal tab." });
    return;
  }
  popupState.tabId = tab.id;

  const foldersReady = sendRuntime<FoldersReply>({ type: "library.folders" })
    .then((f) => { popupState.folders = f; })
    .catch(() => undefined)
    .then(renderFolders);
  try {
    await Promise.all([foldersReady, detectCapture(offerReady)]);
  } catch (err) {
    const offer = await offerReady;
    if (offer) {
      showOffer(offer);
      return;
    }
    findElement("title").textContent = tab.title || "This page";
    setState("empty");
    showNotice({ glyph: "warning", tone: "muted", title: "Could not read this page", detail: formatError(err), tryAnyway: true });
  }
}

void init();
