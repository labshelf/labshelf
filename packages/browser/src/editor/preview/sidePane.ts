// Builds the side pane beside the workbench: the helper setup card above the PDF preview, hidden until either has something to show.
import { el } from "@labshelf/core/dom";
import type { SetupSlot } from "../host";

export interface SidePane {
  setup: SetupSlot;
  /** Holds the rendered pages; what it shows stays until a newer PDF replaces it. */
  pages: HTMLElement;
  status(text: string): void;
  reveal(): void;
}

export function createSidePane(parent: HTMLElement): SidePane {
  const setup = el("section", { class: "editor-pane-setup", hidden: true });
  const status = el("p", { class: "editor-pane-status", "aria-live": "polite" });
  const pages = el("div", { class: "editor-pane-pages" });
  const pane = el("aside", { class: "editor-pane", hidden: true, "aria-label": "Preview" }, setup, status, pages);
  parent.append(pane);
  const reveal = () => {
    if (!pane.hidden) return;
    pane.hidden = false;
    // PLATFORM: the workbench lays itself out again only on a window resize, not when its container narrows.
    window.dispatchEvent(new Event("resize"));
  };
  return {
    setup: { element: setup, reveal: () => { setup.hidden = false; reveal(); } },
    pages,
    status: (text) => { status.textContent = text; },
    reveal,
  };
}
