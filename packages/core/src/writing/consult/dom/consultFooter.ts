// The source editor's consult footer (plan local-sync, consult-window D5): a bottom panel with a Consult button and one chip per open floating
// window, the lowest bottom panel so other panels (proofing notice, Add comment) sit above it.
import { Prec, type Extension } from "@codemirror/state";
import { showPanel, type Panel } from "@codemirror/view";
import { renderElement } from "../../../ui/dom/dom.js";
import type { FloatingWindow, FloatingWindows } from "../../../ui/dom/widgets/floatingWindow.js";
import { renderIcon, type IconName } from "../../../ui/icons/index.js";
import type { ConsultRef } from "../consultRequests.js";

export interface ConsultFooterOptions {
  windows: FloatingWindows;
  onConsult(): void;
  /** False leaves out the Consult button, for a surface that has one in its toolbar; the chips stay. */
  button?: boolean;
}

const KIND_ICONS: Record<ConsultRef["kind"], IconName> = {
  paper: "file-text",
  paperNotes: "edit",
  projectNote: "text-box",
  manuscript: "book-open",
  code: "code",
  pickedFile: "paperclip",
};

/** The icon of a consulted file's kind, shared by the footer chips and the consult windows. */
export function consultKindIcon(kind: ConsultRef["kind"]): IconName {
  return KIND_ICONS[kind];
}

function iconFor(kind: string): IconName {
  return Object.hasOwn(KIND_ICONS, kind) ? consultKindIcon(kind as ConsultRef["kind"]) : "file";
}

function renderChip(win: FloatingWindow): HTMLElement {
  const main = renderElement("button", { type: "button", class: "ls-consult-chip-main", title: win.title },
    renderElement("span", { class: "ls-consult-chip-icon", "aria-hidden": "true", html: renderIcon(iconFor(win.kind)) }),
    renderElement("span", { class: "ls-consult-chip-title", text: win.title }));
  main.addEventListener("click", () => win.bringIntoView());
  const label = `Close ${win.title}`;
  const close = renderElement("button", { type: "button", class: "ls-consult-chip-close", "aria-label": label, title: label, html: renderIcon("x") });
  close.addEventListener("click", (event) => { event.stopPropagation(); void win.close(); });
  return renderElement("span", { class: "ls-consult-chip" }, main, close);
}

function createPanel(options: ConsultFooterOptions): Panel {
  const consult = renderElement("button", { type: "button", class: "ls-consult-button" },
    renderElement("span", { class: "ls-consult-chip-icon", "aria-hidden": "true", html: renderIcon("book") }),
    renderElement("span", { text: "Consult" }));
  consult.addEventListener("click", () => options.onConsult());
  const chips = renderConsultChips(options.windows);
  const dom = renderElement("div", { class: "ls-consult-footer" }, ...(options.button === false ? [] : [consult]), chips.el);
  if (options.button === false) {
    // Without its button the footer only lists windows: hidden while none is open.
    const syncShown = (): void => { dom.hidden = options.windows.list().length === 0; };
    syncShown();
    const stop = options.windows.onChange(syncShown);
    return { dom, destroy: () => { stop(); chips.destroy(); } };
  }
  return { dom, destroy: chips.destroy };
}

/** The strip of chips, one per open window, that follows the windows until `destroy`; shared by the footer and the reader toolbar. */
export function renderConsultChips(windows: FloatingWindows): { el: HTMLElement; destroy(): void } {
  const el = renderElement("div", { class: "ls-consult-chips" });
  const render = (): void => el.replaceChildren(...windows.list().map(renderChip));
  render();
  return { el, destroy: windows.onChange(render) };
}

/** The footer as a CodeMirror extension; it stops listening to the windows when the view is destroyed. */
export function createConsultFooter(options: ConsultFooterOptions): Extension {
  return Prec.lowest(showPanel.of(() => createPanel(options)));
}
