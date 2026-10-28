// Mounts modal dialogs: the overlay with trapped focus, confirmation and progress dialogs, and the form dialog.
import { renderIcon } from "../../icons/index.js";
import { renderElement } from "../dom.js";

/** Options for where an overlay mounts. */
export interface OverlayOptions {
  signal?: AbortSignal;
  /** Mount inside this shadow root (a content script's overlay) instead of document.body. */
  root?: ShadowRoot;
}

export function mountOverlay(content: HTMLElement, onDismiss: () => void, opts: OverlayOptions = {}): { close: () => void } {
  if (opts.signal?.aborted) { onDismiss(); return { close: () => {} }; }
  const parent: ShadowRoot | HTMLElement = opts.root ?? document.body;
  const scope: DocumentOrShadowRoot = opts.root ?? document;
  const scrim = renderElement("div", { class: "ls-scrim dim" });
  const previous = scope.activeElement as HTMLElement | null;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); dismiss(); }
    else if (e.key === "Tab") { trapFocus(e, content, scope); }
  };
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    opts.signal?.removeEventListener("abort", dismiss);
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    content.remove();
    previous?.focus?.();
  };
  const dismiss = (): void => { if (!closed) { close(); onDismiss(); } };
  scrim.addEventListener("mousedown", dismiss);
  document.addEventListener("keydown", onKey, true);
  parent.append(scrim, content);
  opts.signal?.addEventListener("abort", dismiss, { once: true });
  return { close };
}

function trapFocus(e: KeyboardEvent, root: HTMLElement, scope: DocumentOrShadowRoot): void {
  const focusable = Array.from(root.querySelectorAll<HTMLElement>("input, button:not(:disabled), [tabindex]"));
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (e.shiftKey && scope.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && scope.activeElement === last) { e.preventDefault(); first.focus(); }
}

let dialogCount = 0;

export interface DialogButton<T extends string> {
  id: T;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogOptions<T extends string> {
  title: string;
  message?: string;
  severity?: "warning" | "danger" | "info";
  buttons: Array<DialogButton<T>>;
  /** Mount inside this shadow root (a content script's overlay) instead of document.body. */
  root?: ShadowRoot;
}

/** Shows a modal dialog and resolves with the id of the pressed button. */
export function showDialog<T extends string>(opts: DialogOptions<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const actions = renderElement("div", { class: "ls-dialog-actions" });
    const glyph = opts.severity === "info" ? "info" : "warning";
    const id = `ls-dialog-${++dialogCount}`;
    const box = renderElement("div", {
      class: "ls-dialog", role: "alertdialog", "aria-modal": "true",
      "aria-labelledby": `${id}-title`, "aria-describedby": opts.message ? `${id}-msg` : undefined,
    },
      renderElement("div", { class: "ls-dialog-head" },
        renderElement("span", { html: renderIcon(glyph) }),
        renderElement("div", {},
          renderElement("div", { class: "ls-dialog-title", id: `${id}-title`, text: opts.title }),
          opts.message ? renderElement("div", { class: "ls-dialog-msg", id: `${id}-msg`, text: opts.message }) : null,
        ),
      ),
      actions,
    );
    if (opts.severity === "danger") box.querySelector("svg")?.classList.add("danger");
    const { close } = mountOverlay(box, () => resolve(undefined), opts.root ? { root: opts.root } : {});

    // Cancel sits first, primary last — VS Code's button order.
    const cancel = renderElement("button", { class: "ls-btn", type: "button", text: "Cancel" });
    cancel.addEventListener("click", () => { close(); resolve(undefined); });
    actions.append(cancel);
    let primary: HTMLButtonElement | null = null;
    for (const b of opts.buttons) {
      const btn = renderElement("button", { class: `ls-btn${b.primary ? " ls-btn-primary" : ""}${b.danger ? " ls-btn-danger" : ""}`, type: "button", text: b.label });
      btn.addEventListener("click", () => { close(); resolve(b.id); });
      actions.append(btn);
      if (b.primary) primary = btn;
    }
    (primary ?? cancel).focus();
  });
}

/** Two-button confirmation; resolves true when the user accepts. */
export async function askDialog(title: string, message: string, acceptLabel = "OK", danger = false): Promise<boolean> {
  const result = await showDialog({
    title,
    message,
    severity: danger ? "danger" : "warning",
    buttons: [{ id: "ok", label: acceptLabel, primary: true, danger }],
  });
  return result === "ok";
}

/** Options for a form dialog: the primary button's label, a cleanup that runs once on any dismissal, and an abort signal that dismisses it. */
export interface FormDialogOptions {
  submitLabel: string;
  unsubscribe?: () => void;
  signal?: AbortSignal;
}

/** Mounts `form` as a modal with Cancel first and a primary submit button last; returns a close that runs `unsubscribe` and removes the overlay. */
export function mountFormDialog(form: HTMLFormElement, options: FormDialogOptions): () => void {
  const { unsubscribe } = options;
  const overlay = mountOverlay(form, () => unsubscribe?.(), options.signal ? { signal: options.signal } : {});
  const close = (): void => { unsubscribe?.(); overlay.close(); };
  const cancel = renderElement("button", { class: "ls-btn", type: "button", text: "Cancel" });
  cancel.addEventListener("click", close);
  form.append(renderElement("div", { class: "ls-dialog-actions" }, cancel,
    renderElement("button", { class: "ls-btn ls-btn-primary", type: "submit", text: options.submitLabel })));
  return close;
}

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

export function openProgressDialog(opts: ProgressDialogOptions): ProgressDialog {
  const controller = new AbortController();
  const message = renderElement("div", { class: "ls-dialog-msg", "aria-live": "polite", text: opts.message });
  const actions = renderElement("div", { class: "ls-dialog-actions" });
  const box = renderElement("div", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-label": opts.title, tabindex: "-1" },
    renderElement("div", { class: "ls-dialog-head" },
      renderElement("span", { html: renderIcon("info") }),
      renderElement("div", {}, renderElement("div", { class: "ls-dialog-title", text: opts.title }), message),
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
    const cancel = renderElement("button", { class: "ls-btn", type: "button", text: "Cancel" });
    cancel.addEventListener("click", () => { close(); controller.abort(); });
    actions.append(cancel);
    box.append(actions);
    cancel.focus();
  } else {
    box.focus();
  }
  return { update: (text) => { message.textContent = text; }, close, signal: controller.signal };
}
