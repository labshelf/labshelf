/**
 * Modal overlay shared by the dialog and the quick input widgets: a dimmed scrim with Escape
 * dismissal and a focus trap, mounted on the body or inside a shadow root.
 */
import { el } from "../dom.js";

/** Options for where an overlay mounts. */
export interface OverlayOptions {
  /** Mount inside this shadow root (a content script's overlay) instead of document.body. */
  root?: ShadowRoot;
}

/**
 * Renders `content` inside a dimmed scrim; Escape or clicking the scrim runs
 * `onDismiss`. With `opts.root` the overlay mounts inside a shadow root (the
 * Scholar content script's overlay), and focus is read and trapped against
 * that root; without it the behaviour is identical to mounting on the body.
 */
export function mountOverlay(content: HTMLElement, onDismiss: () => void, opts: OverlayOptions = {}): { close: () => void } {
  const parent: ShadowRoot | HTMLElement = opts.root ?? document.body;
  const scope: DocumentOrShadowRoot = opts.root ?? document;
  const scrim = el("div", { class: "ls-scrim dim" });
  const previous = scope.activeElement as HTMLElement | null;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); dismiss(); }
    else if (e.key === "Tab") { trapFocus(e, content, scope); }
  };
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    content.remove();
    previous?.focus?.();
  };
  const dismiss = (): void => { close(); onDismiss(); };
  scrim.addEventListener("mousedown", dismiss);
  document.addEventListener("keydown", onKey, true);
  parent.append(scrim, content);
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
