// Saves the paper on the current tab from the toolbar popup.
// States (data-state on #popup): loading, form | library | empty, saving, saved. A matched PDF offer shows as library.
import { bx, createBrowserLogger, sendRuntime } from "../platform";
import type { FoldersData } from "../platform";
import { $ } from "@labshelf/core/dom";
import { mountSourceBanner } from "../library/libraryLocation";
import { applyTheme } from "../ui";
import { errorMessage, icon } from "@labshelf/core";
import { renderFolders, showStatus, autoGrow } from "./render";
import { attachPdf, inspect, save, undo } from "./captureFlow";
import { dismissOffer, fetchOffer, showOffer } from "./offerCard";
import { popupState, setState } from "./popupState";

function wire(): void {
  $("form").addEventListener("submit", (e) => { e.preventDefault(); void save(); });
  const note = $<HTMLTextAreaElement>("note");
  note.addEventListener("input", () => autoGrow(note));
  note.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
  });
  $("tryAnyway").addEventListener("click", () => { void save(); });
  $("attachPdf").addEventListener("click", () => { void attachPdf(); });
  $("dismissOffer").addEventListener("click", () => { void dismissOffer(); });
  $("undo").addEventListener("click", () => { void undo(); });
  $("open").addEventListener("click", () => {
    const { folder, paper } = $("open").dataset;
    void sendRuntime({ type: "library.open", ...(folder ? { folder } : {}), ...(paper ? { paperId: paper } : {}) }).then(() => window.close());
  });
  $("library").addEventListener("click", () => {
    void sendRuntime({ type: "library.open" }).then(() => window.close());
  });
  $("settings").addEventListener("click", () => { void bx.runtime.openOptionsPage(); window.close(); });
}

async function init(): Promise<void> {
  applyTheme();
  $("brand").innerHTML = `${icon("logo")}<span>LabShelf</span>`;
  $("library").innerHTML = icon("library");
  $("settings").innerHTML = icon("gear");
  $("folderIcon").innerHTML = icon("folder");
  $("folderChevron").innerHTML = icon("chevron-down");
  $("tagsIcon").innerHTML = icon("tag");
  $("noteIcon").innerHTML = icon("message");
  $("undo").innerHTML = icon("trash");
  $("title").classList.add("muted");
  setState("loading");
  wire();
  mountSourceBanner($("sourceBanner"), { logger: createBrowserLogger(), onFolder: () => undefined });

  const [tab] = await bx.tabs.query({ active: true, currentWindow: true });
  // A PDF downloaded from any page, or opened from disk, can still match a paper; the offer then fills the popup.
  const offerReady = tab?.id !== undefined ? fetchOffer(tab.id) : Promise.resolve(null);
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) {
    const offer = await offerReady;
    if (offer) {
      showOffer(offer);
      return;
    }
    $("title").textContent = "Nothing to save here";
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
    $("title").textContent = tab.title || "This page";
    setState("empty");
    showStatus({ glyph: "warning", tone: "muted", title: "Could not read this page", detail: errorMessage(err), tryAnyway: true });
  }
}

void init();
