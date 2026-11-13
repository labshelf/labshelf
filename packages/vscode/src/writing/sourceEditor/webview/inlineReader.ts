// Starts the core reader inside an article's preview pane (inlinePreview.ts). The editor page imports it lazily, so its code and styles load only when an
// article boots it; it is its own entry (build/webviews.mjs, dist/sourceEditor/inlineReader.js), whose stylesheet esbuild does not link, so it links it here.
import "@labshelf/core/styles/reader.css";
import "@labshelf/core/styles/arc-mark.css";
import "@labshelf/core/styles/preview.css";
import "./inlineReader.css";
import { PerfMarks, startReader } from "@labshelf/core/dom";
import type { StartInlineReader } from "./inlinePreview.js";

/** Links the stylesheet esbuild emitted beside this file; resolves once it applies (or failed), so the viewer measures a styled pane. */
function linkStyles(): Promise<void> {
  const href = new URL("./inlineReader.css", import.meta.url).href;
  if (document.head.querySelector(`link[href="${href}"]`)) { return Promise.resolve(); }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  const loaded = new Promise<void>((resolve) => { link.addEventListener("load", () => resolve()); link.addEventListener("error", () => resolve()); });
  document.head.append(link);
  return loaded;
}

export const startInlineReader: StartInlineReader = async (boot, pane, transport) => {
  await linkStyles();
  await startReader({ boot, scope: pane, transport, perf: new PerfMarks() });
};
