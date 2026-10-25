// Holds the popup's mutable session state (current tab, folders, the saved paper, PDF search result, PDF offer) and the
// data-state/#popup DOM toggle that drives which section of the form is visible.
import { findElement } from "@labshelf/core/dom";
import { PAPERS_DIR, renderIcon } from "@labshelf/core";

import type { FoldersData, PdfOfferView, PdfStatusData, SavedPaperData } from "../platform";

export type PopupState = "loading" | "form" | "library" | "empty" | "saving" | "saved";

export const popupState: {
  tabId: number;
  folders: FoldersData;
  saved: SavedPaperData | undefined;
  pdfStatus: PdfStatusData | undefined;
  /** A PDF this tab showed, or the latest download, that matched a paper without a PDF. */
  offer: PdfOfferView | undefined;
} = {
  tabId: -1,
  folders: { folders: [{ path: PAPERS_DIR, depth: 0 }], lastFolder: PAPERS_DIR },
  saved: undefined,
  pdfStatus: undefined,
  offer: undefined,
};

export function setState(state: PopupState): void {
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
