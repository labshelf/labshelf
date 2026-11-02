// Shows a shared deck: its single-file HTML in a sandboxed frame under a bar with Present (talks) and Download HTML.
import { renderElement } from "../../ui/dom/index.js";

export interface DeckShareViewerOptions { title: string; deck: "talk" | "poster"; html: string; download: (bytes: Uint8Array, filename: string) => void }

const BRAND = "Shared with LabShelf";

function fileName(title: string): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${slug || "deck"}.html`;
}

/** Mounts the viewer into `host`; the frame runs the deck's own script without access to the page's origin. */
export function mountDeckShareViewer(host: HTMLElement, options: DeckShareViewerOptions): { destroy(): void } {
  // TRAP: the HTML comes from whoever made the share; without allow-same-origin its script cannot reach this page's storage or DOM.
  const frame = renderElement("iframe", { class: "share-deck-frame", sandbox: "allow-scripts", title: options.title });
  frame.setAttribute("srcdoc", options.html);
  const present = options.deck === "talk"
    ? renderElement("button", { class: "ls-btn ls-btn-primary", type: "button", text: "Present" })
    : null;
  present?.addEventListener("click", () => {
    void Promise.resolve(frame.requestFullscreen()).then(() => frame.focus(), () => undefined);
  });
  const save = renderElement("button", { class: "ls-btn", type: "button", text: "Download HTML" });
  save.addEventListener("click", () => { options.download(new TextEncoder().encode(options.html), fileName(options.title)); });
  const bar = renderElement("div", { class: "share-deck-bar" },
    renderElement("strong", { class: "share-deck-title", text: options.title }),
    renderElement("span", { class: "share-bar-spacer" }),
    renderElement("span", { class: "share-bar-brand", text: BRAND }),
    present, save);
  const root = renderElement("div", { class: "share-deck" }, bar, frame);
  host.append(root);
  return { destroy: () => { root.remove(); } };
}
