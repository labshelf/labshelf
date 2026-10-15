/** Handles clipboard yanks, sort order and what B (export BibTeX) exports. */
import type { PaperRecord } from "@labshelf/core";
import { formatAnnotationsMarkdown, paperComparator, paperFiles, paperLink, papersUnder } from "@labshelf/core";
import * as path from "node:path";

import { copyToClipboard } from "../../../platform/index.js";
import { ALL, SORT_LABEL } from "../types.js";
import type { App } from "../app.js";
import { needPapers } from "./paperFieldActions.js";

export async function yank(app: App, kind: string): Promise<void> {
  const papers = needPapers(app);
  if (!papers.length) { return; }
  const records = papers.map((p) => p.record);
  let text: string;
  let what: string;
  switch (kind) {
    case "cite": text = `\\cite{${records.map((r) => r.citeKey).join(",")}}`; what = "\\cite"; break;
    case "bibtex": text = app.ctx.papers.bibtexFor(records); what = "BibTeX"; break;
    case "link": {
      const links = records.map(paperLink).filter((l): l is string => Boolean(l));
      if (!links.length) { app.taskStatus.notify("No DOI or URL stored", "warn"); return; }
      text = links.join("\n");
      what = links.length === 1 ? links[0]! : "links";
      break;
    }
    case "title": text = records.map((r) => r.title).join("\n"); what = "title"; break;
    case "path": text = records.map((r) => paperFiles(r.path, path.join).pdf).join("\n"); what = "PDF path"; break;
    case "markdown": {
      const parts: string[] = [];
      for (const record of records) {
        parts.push(formatAnnotationsMarkdown(record, (await app.ctx.sidecars.load(record.id)).annotations));
      }
      text = parts.join("\n\n");
      what = "highlights";
      break;
    }
    default: text = records.map((r) => r.citeKey).join(", "); what = records.length === 1 ? records[0]!.citeKey : "cite keys";
  }
  const how = await copyToClipboard(text, (seq) => app.term.writeRaw(seq));
  app.taskStatus.notify(how === "failed" ? "Could not reach the clipboard" : `Copied ${what}${records.length > 1 ? ` (${records.length})` : ""}`,
    how === "failed" ? "error" : "info");
  app.render();
}

export function setSort(app: App, arg: string): void {
  const reverse = arg.endsWith("!");
  const key = arg.replace(/!$/, "") as App["sort"]["key"];
  app.sort = { key, reverse };
  app.taskStatus.notify(`Sorted by ${SORT_LABEL[key]}${reverse ? ", reversed" : ""}`);
}

export function exportName(app: App): string {
  if (app.search !== undefined) { return "search"; }
  if (app.folder === ALL) { return "library"; }
  return path.basename(app.folder || "unfiled");
}

// What B exports: the selection, else the papers pane as shown (with subfolders when a folder is hovered unfiltered).
export function targetsForExport(app: App): PaperRecord[] {
  if (app.selection.size) { return app.listModel.targetPapers().map((p) => p.record); }
  if (app.filter || app.search !== undefined || app.folder === ALL || app.flatten || app.folder === "") {
    return app.listModel.papers().map((p) => p.record);
  }
  return papersUnder(app.ctx.store.snapshot, app.folder).sort(paperComparator(app.sort)).map((p) => p.record);
}
