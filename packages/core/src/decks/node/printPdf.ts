// Prints a single-file deck HTML to a PDF with headless Chromium, or falls back to the HTML for the host to open with #print.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { runCancellable } from "../../latex/node/index.js";
import type { ILogger } from "../../ports/index.js";
import { findSystemChromium, type ChromiumCandidate } from "./findChromium.js";

const MODULE_PRINT = "decks/printPdf";
const DEFAULT_TIMEOUT_MS = 120000;
const OUTPUT_TAIL_CHARS = 2000;

export interface PrintPdfOptions {
  chromium: string;
  run?: typeof runCancellable;
  signal?: AbortSignal;
  timeoutMs?: number;
  logger?: ILogger;
}

/** Runs Chromium headless on a temp copy of `html`; the page size comes from its @page rule. */
export async function printDeckPdf(html: string, options: PrintPdfOptions): Promise<Uint8Array> {
  const run = options.run ?? runCancellable;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-deck-"));
  try {
    const htmlPath = path.join(dir, "deck.html");
    const pdfPath = path.join(dir, "deck.pdf");
    await fs.writeFile(htmlPath, html, "utf8");
    const args = [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-pdf-header-footer",
      `--user-data-dir=${path.join(dir, "profile")}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ];
    const outcome = await run(options.chromium, args, dir, options.signal ?? new AbortController().signal, {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.logger ? { logger: options.logger } : {}),
    });
    const bytes = outcome.code === 0 ? await readOptional(pdfPath) : undefined;
    if (!bytes || bytes.length === 0) {
      throw new Error(`Chromium could not print the deck: ${outcome.output.slice(-OUTPUT_TAIL_CHARS).trim()}`);
    }
    return bytes;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function readOptional(file: string): Promise<Uint8Array | undefined> {
  try {
    return await fs.readFile(file);
  } catch {
    return undefined;
  }
}

export type DeckPdfResult = { kind: "pdf"; path: string } | { kind: "fallback"; htmlPath: string; message: string }

export interface ExportDeckPdfOptions {
  out: string;
  find?: () => Promise<ChromiumCandidate | undefined>;
  run?: typeof runCancellable;
  signal?: AbortSignal;
  logger: ILogger;
}

const INSTALL_HINT = "Install Chrome or Chromium to save the PDF automatically.";
const NOT_FOUND_MESSAGE = `No Chromium was found, so the deck opened for printing. ${INSTALL_HINT}`;
const PRINT_FAILED_MESSAGE = `Chromium could not print the deck, so the deck opened for printing. ${INSTALL_HINT}`;

function fallbackHtmlPath(out: string): string {
  return /\.pdf$/i.test(out) ? out.replace(/\.pdf$/i, ".html") : `${out}.html`;
}

/** Gives a PDF at `out`, or with no Chromium (or a failed print) the HTML beside it for the host to open with #print. */
export async function exportDeckPdf(html: string, options: ExportDeckPdfOptions): Promise<DeckPdfResult> {
  const { out, logger } = options;
  const chromium = await (options.find ?? (() => findSystemChromium()))();
  let message = NOT_FOUND_MESSAGE;
  if (chromium) {
    try {
      const bytes = await printDeckPdf(html, {
        chromium: chromium.path,
        logger,
        ...(options.run ? { run: options.run } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      await fs.writeFile(out, bytes);
      return { kind: "pdf", path: out };
    } catch (error) {
      if (options.signal?.aborted) { throw error; }
      message = PRINT_FAILED_MESSAGE;
      await logger.log("WARN", MODULE_PRINT, "Chromium could not print the deck", { error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    }
  }
  const htmlPath = fallbackHtmlPath(out);
  await fs.writeFile(htmlPath, html, "utf8");
  return { kind: "fallback", htmlPath, message };
}
