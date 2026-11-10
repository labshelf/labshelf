// Tab bodies for project files on /open/: a source file read-only, a deck in the share viewer, a compiled PDF ready to present.
import { decodeMirrorOutput, formatError } from "@labshelf/core";
import type { EditorTabBody } from "@labshelf/core/dom";

import { saveFile } from "../share/shareDownloads.js";
import { exitFullscreen, itemFileMarkdown } from "./sourceView.js";

type Read = (path: string) => Promise<string>;
type Mounted = { destroy(): void } | undefined;

export const STILL_COPYING = "This file is still being copied. Try again in a minute.";

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** Shows "Loading…", then what `fill` mounts; a failure shows in the tab. */
function loadInto(el: HTMLElement, fill: (body: HTMLElement) => Promise<Mounted>, cleanup?: () => void): EditorTabBody {
  const body = document.createElement("div");
  body.className = "open-tab-body";
  body.textContent = "Loading…";
  el.append(body);
  let mounted: Mounted;
  let disposed = false;
  fill(body).then((m) => { mounted = m; if (disposed) { m?.destroy(); } }).catch((err: unknown) => {
    if (!disposed) { body.textContent = `Could not open this: ${formatError(err)}`; }
  });
  return { dispose: () => { disposed = true; mounted?.destroy(); cleanup?.(); body.remove(); } };
}

/** A project source file read-only: a .qmd or .md file in the note editor with editing off, any other file as plain text (the note editor folds code blocks away as cells). */
export function mountSourceTab(el: HTMLElement, path: string, read: Read): EditorTabBody {
  return loadInto(el, async (body) => {
    const text = await read(path);
    body.textContent = "";
    body.classList.add("open-source");
    if (!/\.(qmd|md)$/i.test(path)) {
      const pre = document.createElement("pre");
      pre.className = "open-source-text";
      pre.textContent = text;
      body.append(pre);
      return { destroy: () => { pre.remove(); } };
    }
    const { mountQmdEditor } = await import("@labshelf/core/dom");
    return mountQmdEditor(body, { body: itemFileMarkdown(text), onChange: () => undefined, readOnly: true });
  });
}

/** A deck in the share viewer, whose Present goes full screen; its script runs in a frame without the page's origin. */
export function mountDeckTab(el: HTMLElement, path: string, read: Read): EditorTabBody {
  return loadInto(el, async (body) => {
    const html = await read(path);
    body.textContent = "";
    const { mountDeckShareViewer } = await import("@labshelf/core/dom");
    const title = path.split("/").slice(-2, -1)[0] ?? baseName(path);
    return mountDeckShareViewer(body, {
      title, deck: /poster/i.test(path) ? "poster" : "talk", html,
      download: (bytes, filename) => { saveFile(filename, bytes, "text/html"); },
    });
  });
}

/** A compiled PDF joined from its Mirror parts, with Present (one click to full screen) and Download. */
export function mountPdfTab(el: HTMLElement, output: { path: string; parts: string[] }, read: Read): EditorTabBody {
  let url: string | undefined;
  return loadInto(el, async (body) => {
    const bytes = await decodeMirrorOutput(await Promise.all(output.parts.map(read)));
    if (!bytes) { body.textContent = STILL_COPYING; return undefined; }
    const name = baseName(output.path);
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const viewer = document.createElement("div");
    viewer.className = "open-pdf";
    const bar = document.createElement("div");
    bar.className = "open-pdf-bar";
    const title = document.createElement("strong");
    title.textContent = name;
    const present = document.createElement("button");
    present.type = "button";
    present.className = "ls-btn ls-btn-primary";
    present.textContent = "Present";
    present.addEventListener("click", () => { viewer.requestFullscreen?.().catch(() => undefined); });
    const download = document.createElement("button");
    download.type = "button";
    download.className = "ls-btn";
    download.textContent = "Download";
    download.addEventListener("click", () => { saveFile(name, bytes, "application/pdf"); });
    bar.append(title, present, download);
    const frame = document.createElement("iframe");
    frame.className = "open-pdf-frame";
    frame.title = name;
    frame.src = url;
    viewer.append(bar, frame);
    body.replaceChildren(viewer);
    return { destroy: () => { if (document.fullscreenElement === viewer) { exitFullscreen(); } viewer.remove(); } };
  }, () => { if (url) { URL.revokeObjectURL(url); } });
}
