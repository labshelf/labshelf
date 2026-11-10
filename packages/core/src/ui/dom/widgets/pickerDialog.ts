// The shell of the picker popups (the reader's cite popup, Insert code in a manuscript): a title with its badges, a row of
// labelled pickers, the body, a status line and the actions, mounted over a scrim. Styled by cite-dialog.css
// (`@labshelf/core/styles/cite-dialog.css`), which every host of one of these popups loads.
import { renderElement } from "../dom.js";
import { mountOverlay } from "./dialog.js";

export interface PickerDialogOptions {
  heading: string;
  /** Short texts beside the heading, such as the page cited. */
  badges?: readonly string[];
  /** The labelled controls of the picker row. */
  pickers: ReadonlyArray<{ label: string; control: HTMLElement }>;
  /** The actions before the spacer (Copy) and after it (Cancel, then the primary one). */
  leading: readonly HTMLElement[];
  trailing: readonly HTMLElement[];
  /** Runs once when Escape or the scrim dismisses the popup; `close()` does not run it. */
  onDismiss: () => void;
}

export interface PickerDialog {
  content: HTMLElement;
  pickers: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
  /** Shows a sentence in the status line, in the error colour when `error`. */
  showStatus(message: string, error?: boolean): void;
  close(): void;
}

/** A dialog text button; `extra` adds classes such as `rd-btn-primary`. */
export function renderTextButton(label: string, extra = ""): HTMLButtonElement {
  return renderElement("button", { type: "button", class: `rd-btn-text ${extra}`.trim() }, label);
}

/** Builds the popup and mounts it at once. */
export function renderPickerDialog(options: PickerDialogOptions): PickerDialog {
  const { heading } = options;
  const title = renderElement("div", { class: "rd-cite-dialog-title" },
    renderElement("span", { text: heading }),
    ...(options.badges ?? []).map((badge) => renderElement("span", { class: "rd-cite-dialog-page", text: badge })));
  const pickers = renderElement("div", { class: "rd-cite-dialog-pickers" },
    ...options.pickers.map(({ label, control }) => renderElement("label", { class: "rd-cite-dialog-field" }, renderElement("span", { text: label }), control)));
  const body = renderElement("div", { class: "rd-cite-dialog-source" });
  const status = renderElement("div", { class: "rd-cite-dialog-status", role: "status", "aria-live": "polite" });
  const footer = renderElement("div", { class: "rd-cite-dialog-actions" }, ...options.leading, renderElement("span", { class: "rd-spacer" }), ...options.trailing);
  const content = renderElement("div", { class: "ls-dialog rd-cite-dialog", role: "dialog", "aria-modal": "true", "aria-label": heading },
    title, pickers, body, status, footer);
  const overlay = mountOverlay(content, options.onDismiss);
  return {
    content, pickers, body, status,
    showStatus(message, error = false) {
      status.textContent = message;
      status.classList.toggle("rd-cite-dialog-error", error);
    },
    close: overlay.close,
  };
}
