// Registers the OCR text-layer commands, for one paper or the whole library, and summarizes the result.
import * as vscode from "vscode";

import { type PaperRecord } from "@labshelf/core";
import type { PaperService } from "../library/index.js";
import { addTextLayerJobs } from "./textLayerQueue.js";
import { resolvePaper } from "./paperResolution.js";
import { runSafely, type EnsureServices } from "./commandContext.js";

export function registerTextLayerCommands(context: vscode.ExtensionContext, requireServices: EnsureServices): void {
  context.subscriptions.push(
    // Called with paper ids from the list panel, or with nothing from the palette.
    vscode.commands.registerCommand("labshelf.makeSearchable", async (target?: string | string[]) => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.makeSearchable", async () => {
        const papers = target !== undefined
          ? await papersByIds(services.paperService, Array.isArray(target) ? target : [target])
          : [await resolvePaper(services.paperService, undefined, "Make a scanned paper searchable (OCR)")].filter(isPaper);
        if (papers.length > 0) {
          await addTextLayerJobs(services.textLayers, papers, { logger: services.logger, announceAll: true });
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.makeLibrarySearchable", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.makeLibrarySearchable", async () => {
        // Papers that already have text are skipped in a fraction of a second
        // each; papers saved without a PDF have nothing to read and are left out.
        const papers = (await services.paperService.listPapers()).filter((p) => p.hasPdf !== false);
        await addTextLayerJobs(services.textLayers, papers, { logger: services.logger });
        const checked = await services.paperService.listPapers();
        void vscode.window.showInformationMessage(`LabShelf: ${describeLibraryTextLayers(checked)}`);
      });
    }),
  );
}

// Resolves ids from a webview message to papers, dropping any missing from the library.
async function papersByIds(paperService: PaperService, ids: string[]): Promise<PaperRecord[]> {
  const wanted = new Set(ids);
  return (await paperService.listPapers()).filter((paper) => wanted.has(paper.id));
}

function isPaper(value: PaperRecord | undefined): value is PaperRecord {
  return value !== undefined;
}

/**
 * Summarizes the text layers across the library after a library-wide pass.
 * @returns e.g. "Library checked: 12 with text, 2 made searchable by OCR, 1 without text."
 */
export function describeLibraryTextLayers(papers: PaperRecord[]): string {
  const count = (state: string): number => papers.filter((paper) => paper.textLayer?.state === state).length;
  const parts = [`${count("native")} with text`];
  if (count("ocr") > 0) { parts.push(`${count("ocr")} made searchable by OCR`); }
  const without = count("missing") + count("failed");
  if (without > 0) { parts.push(`${without} without text (see the "No text" filter)`); }
  return `Library checked: ${parts.join(", ")}.`;
}
