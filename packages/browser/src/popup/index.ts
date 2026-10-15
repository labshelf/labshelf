// Saves the paper on the current tab from the toolbar popup.
// States (data-state on #popup): loading, form | library | empty, saving, saved.
import { bx } from "../platform";
import type { FoldersData } from "../platform";
import { $ } from "@labshelf/core/dom";
import { applyTheme } from "../ui";
import { icon } from "@labshelf/core";
import { renderFolders, showStatus, autoGrow } from "./render";
import { attachPdf, inspect, save, undo } from "./saveFlow";
import { errorText, send } from "./runtimeSend";
import { renderSync } from "./syncButton";
import { popupState, setState } from "./state";

function wire(): void {
  $("form").addEventListener("submit", (e) => { e.preventDefault(); void save(); });
  const note = $<HTMLTextAreaElement>("note");
  note.addEventListener("input", () => autoGrow(note));
  note.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
  });
  $("tryAnyway").addEventListener("click", () => { void save(); });
  $("attachPdf").addEventListener("click", () => { void attachPdf(); });
  $("undo").addEventListener("click", () => { void undo(); });
  $("open").addEventListener("click", () => {
    const { folder, paper } = $("open").dataset;
    void send({ type: "library.open", ...(folder ? { folder } : {}), ...(paper ? { paperId: paper } : {}) }).then(() => window.close());
  });
  $("library").addEventListener("click", () => {
    void send({ type: "library.open" }).then(() => window.close());
  });
  $("settings").addEventListener("click", () => { void bx.runtime.openOptionsPage(); window.close(); });
  $("sync").addEventListener("click", () => {
    if ($("sync").dataset["action"] === "sync") {
      void send({ type: "sync.now" }).then(renderSync).then(() => setTimeout(() => { void renderSync(); }, 4000));
    } else {
      void bx.runtime.openOptionsPage();
      window.close();
    }
  });
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
  void renderSync();

  const [tab] = await bx.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) {
    $("title").textContent = "Nothing to save here";
    setState("empty");
    showStatus({ glyph: "globe", tone: "muted", title: "This page can't be saved", detail: "Open an article's page or its PDF in a normal tab." });
    return;
  }
  popupState.tabId = tab.id;

  const foldersReady = send<FoldersData>({ type: "library.folders" })
    .then((f) => { popupState.folders = f; })
    .catch(() => undefined)
    .then(renderFolders);
  try {
    await Promise.all([foldersReady, inspect()]);
  } catch (err) {
    $("title").textContent = tab.title || "This page";
    setState("empty");
    showStatus({ glyph: "warning", tone: "muted", title: "Could not read this page", detail: errorText(err), tryAnyway: true });
  }
}

void init();
