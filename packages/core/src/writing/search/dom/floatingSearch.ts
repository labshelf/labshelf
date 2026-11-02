// Floats the project search over a source editor, in its top-right corner, as Overleaf's search does; the editor's Search button toggles it.
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon } from "../../../ui/icons/index.js";
import type { SearchTransport } from "../protocol/index.js";
import { mountProjectSearch } from "./mountProjectSearch.js";

export interface FloatingSearch {
  /** Opens the panel and focuses its search field, or closes it when open. */
  toggle(): void;
  open(): void;
  close(): void;
  dispose(): void;
}

/**
 * Adds the hidden panel to `host`, which must be positioned. The search mounts on the first open, so the host side
 * that `connect` returns only starts answering once the user asks for it.
 */
export function mountFloatingSearch(host: HTMLElement, connect: () => SearchTransport): FloatingSearch {
  const close = renderElement("button", { type: "button", class: "ls-icon-btn", title: "Close (Escape)", "aria-label": "Close search", html: renderIcon("x") });
  const body = renderElement("div", { class: "ls-psearch-float-body" });
  const panel = renderElement("div", { class: "ls-psearch-float", role: "dialog", "aria-label": "Search in project", hidden: true },
    renderElement("header", { class: "ls-psearch-float-head" }, renderElement("span", { text: "Search in project" }), close),
    body);
  host.classList.add("ls-psearch-float-host");
  host.append(panel);
  let mounted = false;

  const focusField = (): void => { panel.querySelector<HTMLInputElement>(".ls-psearch-input")?.select(); panel.querySelector<HTMLInputElement>(".ls-psearch-input")?.focus(); };
  const api: FloatingSearch = {
    open() {
      if (!mounted) { mounted = true; mountProjectSearch(body, connect()); }
      panel.hidden = false;
      focusField();
    },
    close() { panel.hidden = true; },
    toggle() { if (panel.hidden) api.open(); else api.close(); },
    dispose() { panel.remove(); host.classList.remove("ls-psearch-float-host"); },
  };
  close.addEventListener("click", () => api.close());
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    api.close();
  });
  return api;
}
