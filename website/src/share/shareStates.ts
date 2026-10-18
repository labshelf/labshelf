// Shows the page's waiting and failure states, and names why a shared PDF could not be read, in the visitor's words.
import type { LoadPdfError, OpenShareError } from "@labshelf/core";
import { el, icon, type IconName } from "@labshelf/core/dom";

export interface PageState {
  icon: IconName;
  text: string;
  hint?: string;
  /** Shown as a Retry button. */
  retry?: () => void;
  /** Shown as a Back to folder button. */
  back?: () => void;
}

export const LOADING_STATE: PageState = { icon: "loader", text: "Opening the shared folder…" };

const NETWORK_HINT = "Check your connection and try again.";

export function openErrorState(error: OpenShareError, retry: () => void): PageState {
  switch (error) {
    case "removed": return { icon: "link", text: "This link was removed", hint: "The person who shared this folder stopped sharing it." };
    case "network": return { icon: "cloud-off", text: "Could not reach the shared folder", hint: NETWORK_HINT, retry };
    case "malformedLink": case "unreadable":
      return { icon: "warning", text: "This link is incomplete or damaged", hint: "Ask for the link again and copy all of it." };
  }
}

export const PDF_ERROR_TEXT: Record<LoadPdfError, string> = {
  noPdf: "This paper was shared without a PDF.",
  missing: "This PDF is no longer in the shared folder.",
  tampered: "This PDF does not match what was shared, so it was not opened.",
  network: `Could not download this PDF. ${NETWORK_HINT}`,
};

export function renderState(root: HTMLElement, state: PageState): void {
  const actions = el("div", { class: "share-state-actions" },
    state.retry ? el("button", { class: "ls-btn ls-btn-primary", type: "button", text: "Retry" }) : null,
    state.back ? el("button", { class: "ls-btn", type: "button", html: `${icon("arrow-left")}<span>Back to folder</span>` }) : null);
  actions.querySelector(".ls-btn-primary")?.addEventListener("click", () => state.retry?.());
  actions.querySelector(".ls-btn:not(.ls-btn-primary)")?.addEventListener("click", () => state.back?.());
  root.replaceChildren(el("div", { class: "ls-empty share-state", role: state.icon === "loader" ? "status" : "alert" },
    el("div", { class: `ls-empty-icon${state.icon === "loader" ? " share-spin" : ""}`, html: icon(state.icon) }),
    el("div", { class: "ls-empty-text", text: state.text }),
    state.hint ? el("div", { class: "ls-empty-hint", text: state.hint }) : null,
    actions.childElementCount > 0 ? actions : null));
}
