// Opens a paper's PDF in the configured viewer, from an id, a cite key or a labshelf: link.
import * as path from "node:path";

import { papersByCiteKey, paperFiles, paperLink, parseLabshelfLink, type LabshelfLink, type PaperEntry } from "@labshelf/core";

import type { AppContext } from "../app/index.js";
import { openExternal, viewerTakesPage } from "../platform/index.js";
import { requirePaper } from "./paperLookup.js";
import { UsageError, type Output } from "./usage.js";

function entryForLink(ctx: AppContext, link: LabshelfLink): PaperEntry {
  const records = [...ctx.store.snapshot.papers.values()].map((e) => e.record);
  const record = papersByCiteKey(records).get(link.citeKey);
  const entry = record && ctx.store.paper(record.id);
  if (!entry) { throw new UsageError(`No paper with cite key "${link.citeKey}"`); }
  return entry;
}

/**
 * Opens the PDF of `<id | citeKey | labshelf: link>`. A viewer with a `{page}` token gets the link's page, else the
 * saved reading position, else 1; any other viewer opens the file and the page is printed.
 * @returns the exit code
 */
export async function runOpen(ctx: AppContext, positionals: string[], io: Output): Promise<number> {
  const argument = positionals[0] ?? "";
  const link = parseLabshelfLink(argument);
  const entry = link ? entryForLink(ctx, link) : requirePaper(ctx, argument);
  const { id, citeKey } = entry.record;
  if (entry.record.hasPdf === false) {
    const web = paperLink(entry.record);
    io.err(`No PDF on this device for ${id}${web ? ` (${web})` : ""}`);
    void ctx.logger.log("WARN", "terminal.open", "paper has no PDF on this device", { id });
    return 1;
  }
  const page = link?.page ?? (await ctx.sidecars.load(id)).reading?.page;
  const viewer = process.env["LABSHELF_PDF_VIEWER"] || ctx.config.terminal?.pdfViewer;
  try {
    openExternal(paperFiles(entry.record.path, path.join).pdf, viewer, page);
    const pageUsed = viewerTakesPage(viewer);
    void ctx.logger.log("INFO", "terminal.open", "opened PDF", { id, page: page ?? null, pageUsed });
    if (link?.page !== undefined && !pageUsed) { io.out(`Opened ${citeKey} — go to page ${link.page}`); }
  } catch (error) {
    void ctx.logger.error("terminal.open", error, { id });
    io.err(`Could not open the PDF for ${id}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  return 0;
}
