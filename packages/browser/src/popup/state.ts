// Holds the popup's mutable session state (current tab, folders, the saved paper, PDF search result) and the
// data-state/#popup DOM toggle that drives which section of the form is visible.
import { $ } from "@labshelf/core/dom";
import { PAPERS_DIR, icon } from "@labshelf/core";

import type { FoldersData, PdfStatusData, SavedPaperData } from "../platform";

export type PopupState = "loading" | "form" | "library" | "empty" | "saving" | "saved";

export const popupState: {
  tabId: number;
  folders: FoldersData;
  saved: SavedPaperData | undefined;
  pdfStatus: PdfStatusData | undefined;
} = {
  tabId: -1,
  folders: { folders: [{ path: PAPERS_DIR, label: "Library", depth: 0 }], lastFolder: PAPERS_DIR },
  saved: undefined,
  pdfStatus: undefined,
};

export function setState(state: PopupState): void {
  $("popup").dataset["state"] = state;
  $("form").hidden = !(state === "form" || state === "saving");
  $("status").hidden = !(state === "library" || state === "empty" || state === "saved");
  const busy = state === "saving";
  for (const id of ["folder", "tags", "note", "save"]) $<HTMLInputElement>(id).disabled = busy;
  // While searching, pdfStatus is undefined; Save then waits on the search.
  $("save").innerHTML = busy
    ? `<span class="spin">${icon("refresh")}</span><span>${popupState.pdfStatus ? "Saving…" : "Looking for the PDF…"}</span>`
    : `<span>Save to LabShelf</span>`;
}
