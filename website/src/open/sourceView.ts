// Presents a paper's notes full screen: a panel over the page, read-only notes in large type, Full screen and Close; loaded only when opened.
import { formatError, parseItemFile } from "@labshelf/core";

export interface RemoteView { close(): void }

type Mounted = { destroy(): void } | undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) { node.textContent = text; }
  return node;
};

const openViews = new Set<RemoteView>();

/** The Markdown a .qmd item file shows: its items' bodies in file order, so the editor renders them rather than the item fences; a file without items as it is. */
function itemFileMarkdown(text: string): string {
  const bodies = parseItemFile(text).segments.flatMap((s) => s.kind === "item" ? [s.body.trim()] : []);
  return bodies.length ? bodies.join("\n\n") : text;
}

/** Leaves full screen when the page holds it; a refusal changes nothing. */
export function exitFullscreen(): void {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => undefined); }
}

/** Closes every panel still open, so none outlives the library that opened it. */
export function closeAllViews(): void {
  for (const view of [...openViews]) { view.close(); }
}

/**
 * Opens the notes in the presentation panel and asks for full screen at once, within the click's activation; when the browser
 * refuses, the panel still fills the window. Esc leaves full screen and keeps the panel; Close leaves both.
 */
export function showNotes(title: string, read: () => Promise<string>): RemoteView {
  const panel = el("div", "open-present");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", title);
  const bar = el("div", "open-present-bar");
  const heading = el("strong", "open-present-title", title);
  const toggle = el("button", "ls-btn", "Exit full screen");
  toggle.type = "button";
  const closeButton = el("button", "ls-btn", "Close");
  closeButton.type = "button";
  bar.append(heading, toggle, closeButton);
  const body = el("div", "open-present-body", "Loading…");
  panel.append(bar, body);
  document.body.append(panel);

  const full = (): boolean => document.fullscreenElement === panel;
  const paint = (): void => { toggle.textContent = full() ? "Exit full screen" : "Full screen"; };
  const enter = (): void => { panel.requestFullscreen?.().catch(() => undefined).finally(paint); };
  enter();
  paint();
  document.addEventListener("fullscreenchange", paint);
  toggle.addEventListener("click", () => { if (full()) { exitFullscreen(); } else { enter(); } });

  let mounted: Mounted;
  let closed = false;
  const close = (): void => {
    closed = true;
    openViews.delete(view);
    document.removeEventListener("fullscreenchange", paint);
    if (full()) { exitFullscreen(); }
    mounted?.destroy();
    panel.remove();
  };
  const view: RemoteView = { close };
  openViews.add(view);
  closeButton.addEventListener("click", close);
  read().then(async (text) => {
    if (closed) { return; }
    body.textContent = "";
    const { mountQmdEditor } = await import("@labshelf/core/dom");
    mounted = mountQmdEditor(body, { body: itemFileMarkdown(text), onChange: () => undefined, readOnly: true });
    if (closed) { mounted.destroy(); }
  }).catch((err: unknown) => {
    if (!closed) { body.textContent = `Could not open this: ${formatError(err)}`; }
  });
  return view;
}
