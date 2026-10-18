// Adds the Library | Writing tab bar above the library frame and shows the Writing pane on the #/writing route.
import { el } from "@labshelf/core/dom";
import { isWritingHash, WRITING_HASH } from "../router";

const TABS = [{ id: "library", label: "Library" }, { id: "writing", label: "Writing" }] as const;
type TabId = (typeof TABS)[number]["id"];

/** Inserts the tab bar before `frame` and returns the Writing pane, which follows the frame; `onWriting` runs each time it is shown. */
export function mountPageTabs(frame: HTMLElement, lastLibraryHash: () => string, onWriting: () => void): HTMLElement {
  const pane = el("div", { class: "writing-pane", role: "tabpanel", "aria-label": "Writing" });
  const buttons = new Map<TabId, HTMLButtonElement>();
  const bar = el("div", { class: "page-tabs", role: "tablist" });
  for (const { id, label } of TABS) {
    const button = el("button", { class: "page-tab", type: "button", role: "tab" }, label);
    button.addEventListener("click", () => { location.hash = id === "writing" ? WRITING_HASH : lastLibraryHash(); });
    buttons.set(id, button);
    bar.append(button);
  }
  frame.before(bar);
  frame.after(pane);

  const render = (): void => {
    const active: TabId = isWritingHash(location.hash) ? "writing" : "library";
    for (const [id, button] of buttons) {
      button.classList.toggle("active", id === active);
      button.setAttribute("aria-selected", String(id === active));
    }
    frame.hidden = active === "writing";
    pane.hidden = active !== "writing";
    if (active === "writing") onWriting();
  };
  window.addEventListener("hashchange", render);
  render();
  return pane;
}
