// Read-only views of what the Mirror holds: a note, a project source file or a deck, each in a panel over the page and each loaded only when opened.
import { formatError } from "@labshelf/core";

import { saveFile } from "../share/shareDownloads.js";

export interface RemoteView { close(): void }

type Mounted = { destroy(): void } | undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) { node.textContent = text; }
  return node;
};

const openViews = new Set<RemoteView>();

/** Closes every panel still open, so none outlives the library that opened it. */
export function closeAllViews(): void {
  for (const view of [...openViews]) { view.close(); }
}

/** A panel with a title and Close, filled by `fill` once the text has been read; read and mount failures show in the panel. */
function openPanel(title: string, read: () => Promise<string>, fill: (body: HTMLElement, text: string) => Promise<Mounted>): RemoteView {
  const panel = el("div", "open-view");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", title);
  panel.style.cssText = "position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;background:var(--ls-bg-surface, var(--ls-bg, #fff));color:var(--ls-text, inherit)";
  const bar = el("div", "open-view-bar");
  bar.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--ls-border, #ddd)";
  const heading = el("strong", "open-view-title", title);
  heading.style.flex = "1";
  const closeButton = el("button", "ls-btn", "Close");
  closeButton.type = "button";
  bar.append(heading, closeButton);
  const body = el("div", "open-view-body", "Loading…");
  body.style.cssText = "flex:1;min-height:0;overflow:auto";
  panel.append(bar, body);
  document.body.append(panel);

  let mounted: Mounted;
  let closed = false;
  const close = (): void => {
    closed = true;
    openViews.delete(view);
    mounted?.destroy();
    panel.remove();
  };
  const view: RemoteView = { close };
  openViews.add(view);
  closeButton.addEventListener("click", close);
  read().then(async (text) => {
    if (closed) { return; }
    body.textContent = "";
    mounted = await fill(body, text);
    if (closed) { mounted?.destroy(); }
  }).catch((err: unknown) => {
    if (!closed) { body.textContent = `Could not open this: ${formatError(err)}`; }
  });
  return view;
}

/** A note, in the notes editor with editing off. */
export function showNotes(title: string, read: () => Promise<string>): RemoteView {
  return openPanel(title, read, async (body, text) => {
    const { mountQmdEditor } = await import("@labshelf/core/dom");
    return mountQmdEditor(body, { body: text, onChange: () => undefined, readOnly: true });
  });
}

/** The text as a Markdown body: a .qmd or .md file as it is, any other file as one code block (its fence is longer than any run of backticks inside). */
function sourceBody(file: string, text: string): string {
  if (/\.(qmd|md)$/i.test(file)) { return text; }
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** A project source file, in the editor with editing off (website has no CodeMirror of its own, so the core note editor shows it). */
export function showSource(file: string, read: () => Promise<string>): RemoteView {
  return openPanel(file, read, async (body, text) => {
    const { mountQmdEditor } = await import("@labshelf/core/dom");
    return mountQmdEditor(body, { body: sourceBody(file, text), onChange: () => undefined, readOnly: true });
  });
}

/** A deck, in the share viewer: its script runs in a frame without the page's origin. */
export function showDeck(title: string, deck: "talk" | "poster", read: () => Promise<string>): RemoteView {
  return openPanel(title, read, async (body, html) => {
    const { mountDeckShareViewer } = await import("@labshelf/core/dom");
    return mountDeckShareViewer(body, { title, deck, html, download: (bytes, filename) => { saveFile(filename, bytes, "text/html"); } });
  });
}
