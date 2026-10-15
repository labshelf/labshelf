/**
 * Popup bootstrap. One job: save the paper on this tab. It shows what was
 * recognised (title, authors · venue · year, whether the PDF was found),
 * lets the user pick the folder and add tags and a note, and saves. Sync,
 * the library and settings are icon buttons in the header; Drive connection
 * lives on the options page.
 *
 * States (data-state on #popup): loading → form (a paper, not yet saved) |
 * library (already saved) | empty (no paper here) → saving → saved. A paper
 * whose PDF the search cannot reach is never written silently: the user is
 * asked first through the shared "No PDF found" dialog.
 */
import { bx } from "../platform/browserApi";
import type { FoldersData } from "../platform/runtimeMessages";
import { $ } from "@labshelf/core/dom";
import { applyTheme } from "../ui/theme";
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
