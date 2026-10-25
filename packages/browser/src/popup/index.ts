// Saves the paper on the current tab from the toolbar popup.
// States (data-state on #popup): loading, form | library | empty, saving, saved. A matched PDF offer shows as library.
import { bx, createBrowserLogger, sendRuntime } from "../platform";
import type { FoldersData } from "../platform";
import { findElement } from "@labshelf/core/dom";
import { mountSourceBanner } from "../library/libraryLocation";
import { applyTheme } from "../ui";
import { formatError, renderIcon } from "@labshelf/core";
import { renderFolders, showStatus, autoGrow } from "./render";
import { attachPdf, inspect, save, undo } from "./captureFlow";
import { dismissOffer, fetchOffer, showOffer } from "./offerCard";
import { popupState, setState } from "./popupState";

function wire(): void {
  findElement("form").addEventListener("submit", (e) => { e.preventDefault(); void save(); });
  const note = findElement<HTMLTextAreaElement>("note");
  note.addEventListener("input", () => autoGrow(note));
  note.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
  });
  findElement("tryAnyway").addEventListener("click", () => { void save(); });
  findElement("attachPdf").addEventListener("click", () => { void attachPdf(); });
  findElement("dismissOffer").addEventListener("click", () => { void dismissOffer(); });
  findElement("undo").addEventListener("click", () => { void undo(); });
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
    showStatus({ glyph: "globe", tone: "muted", title: "This page can't be saved", detail: "Open an article's page or its PDF in a normal tab." });
    return;
  }
  popupState.tabId = tab.id;

  const foldersReady = sendRuntime<FoldersData>({ type: "library.folders" })
    .then((f) => { popupState.folders = f; })
    .catch(() => undefined)
    .then(renderFolders);
  try {
    await Promise.all([foldersReady, inspect(offerReady)]);
  } catch (err) {
    const offer = await offerReady;
    if (offer) {
      showOffer(offer);
      return;
    }
    findElement("title").textContent = tab.title || "This page";
    setState("empty");
    showStatus({ glyph: "warning", tone: "muted", title: "Could not read this page", detail: formatError(err), tryAnyway: true });
  }
}

void init();
