// Mounts cancellable modal overlays with trapped keyboard focus.
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
