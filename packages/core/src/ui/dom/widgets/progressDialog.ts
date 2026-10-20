// Shows a modal progress dialog with live message updates and an optional Cancel that aborts a signal.
import { icon } from "../../icons/index.js";
import { el } from "../dom.js";
import { mountOverlay } from "./overlay.js";

export interface ProgressDialogOptions {
  title: string;
  message: string;
  cancellable?: boolean;
  /** Mount inside this shadow root (a content script's overlay) instead of document.body. */
  root?: ShadowRoot;
}

export interface ProgressDialog {
  update(message: string): void;
  close(): void;
  /** Aborts when the user cancels; it never aborts on `close()`. */
  signal: AbortSignal;
}

export function progressDialog(opts: ProgressDialogOptions): ProgressDialog {
  const controller = new AbortController();
  const message = el("div", { class: "ls-dialog-msg", "aria-live": "polite", text: opts.message });
  const actions = el("div", { class: "ls-dialog-actions" });
  const box = el("div", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-label": opts.title, tabindex: "-1" },
    el("div", { class: "ls-dialog-head" },
      el("span", { html: icon("info") }),
      el("div", {}, el("div", { class: "ls-dialog-title", text: opts.title }), message),
    ),
  );
  const cancellable = opts.cancellable === true;
  // The overlay dismisses on Escape and scrim clicks; a dialog that cannot be cancelled swallows both before it sees them.
  const swallow = (e: Event): void => {
    const hit = e instanceof KeyboardEvent ? e.key === "Escape" : (e.target as HTMLElement | null)?.classList.contains("ls-scrim");
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  if (!cancellable) {
    document.addEventListener("keydown", swallow, true);
    document.addEventListener("mousedown", swallow, true);
  }
  const overlay = mountOverlay(box, () => controller.abort(), opts.root ? { root: opts.root } : {});
  const close = (): void => {
    document.removeEventListener("keydown", swallow, true);
    document.removeEventListener("mousedown", swallow, true);
    overlay.close();
  };
  if (cancellable) {
    const cancel = el("button", { class: "ls-btn", type: "button", text: "Cancel" });
    cancel.addEventListener("click", () => { close(); controller.abort(); });
    actions.append(cancel);
    box.append(actions);
    cancel.focus();
  } else {
    box.focus();
  }
  return { update: (text) => { message.textContent = text; }, close, signal: controller.signal };
}
