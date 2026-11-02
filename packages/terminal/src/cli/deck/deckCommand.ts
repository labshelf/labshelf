// Exports a talk or poster folder as one offline HTML file or as a PDF, with the print fallback when no Chromium is found.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { exportDeckHtml, formatError } from "@labshelf/core";
import { exportDeckPdf, type ChromiumCandidate } from "@labshelf/core/decks/node";
import { loadCoreMath } from "@labshelf/core/math";
import type { runCancellable } from "@labshelf/core/node";

import type { AppContext } from "../../compositionRoot.js";
import { openExternal } from "../../platform/system.js";
import type { CliArgs } from "../args.js";
import { UsageError, type Output } from "../usage.js";

export interface DeckCommandDeps { find?: () => Promise<ChromiumCandidate | undefined>; run?: typeof runCancellable; open?: (target: string) => void }

const EXPORT_USAGE = "Usage: labshelf deck export <deck.html|folder> --pdf|--html [--out <file>]";

/** The deck file and its folder for a deck.html path or the folder holding it. */
async function locateDeck(target: string): Promise<{ file: string; folder: string }> {
  const resolved = path.resolve(target);
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) { return { file: path.join(resolved, "deck.html"), folder: resolved }; }
  return { file: resolved, folder: path.dirname(resolved) };
}

/** Reads a file inside `folder` only; a resolved path outside it or a missing file gives undefined. */
async function readInside(folder: string, relative: string): Promise<Uint8Array | undefined> {
  const resolved = path.resolve(folder, relative);
  const inside = path.relative(folder, resolved);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) { return undefined; }
  try { return new Uint8Array(await fs.readFile(resolved)); } catch { return undefined; }
}

/** @returns the HTML text of the exported deck */
async function buildHtml(file: string, folder: string): Promise<string> {
  const source = await fs.readFile(file, "utf8");
  const theme = await fs.readFile(path.join(folder, "theme.css"), "utf8").catch(() => "");
  const { renderMathSvg } = await loadCoreMath();
  return exportDeckHtml(source, { theme, readAsset: (relative) => readInside(folder, relative), renderMath: renderMathSvg });
}

/**
 * @returns the exit code: 1 when the deck cannot be read or has errors
 * @throws UsageError when the subcommand, the path or the format flags are wrong
 */
export async function runDeck(
  ctx: Pick<AppContext, "logger">, positionals: string[], flags: CliArgs["flags"], io: Output, deps: DeckCommandDeps = {},
): Promise<number> {
  const [subcommand, target, ...extra] = positionals;
  if (subcommand !== "export") { throw new UsageError(`Unknown deck command "${subcommand ?? ""}". ${EXPORT_USAGE}`); }
  if (!target || extra.length > 0) { throw new UsageError(EXPORT_USAGE); }
  const wantPdf = flags["pdf"] === true;
  const wantHtml = flags["html"] === true;
  if (wantPdf === wantHtml) { throw new UsageError(`Choose exactly one of --pdf and --html. ${EXPORT_USAGE}`); }
  const outFlag = flags["out"];
  const out = typeof outFlag === "string" && outFlag !== "" ? path.resolve(outFlag) : undefined;

  try {
    const { file, folder } = await locateDeck(target);
    const html = await buildHtml(file, folder);
    const base = path.join(folder, path.basename(folder));
    if (wantHtml) {
      const htmlPath = out ?? `${base}.html`;
      await fs.mkdir(path.dirname(htmlPath), { recursive: true });
      await fs.writeFile(htmlPath, html, "utf8");
      io.out(`Wrote ${htmlPath}`);
      return 0;
    }
    const result = await exportDeckPdf(html, { out: out ?? `${base}.pdf`, ...(deps.find && { find: deps.find }), ...(deps.run && { run: deps.run }), logger: ctx.logger });
    if (result.kind === "pdf") {
      io.out(`Wrote ${result.path}`);
      return 0;
    }
    (deps.open ?? openExternal)(`${pathToFileURL(result.htmlPath).href}#print`);
    io.out(result.message);
    return 0;
  } catch (error) {
    io.err(`Could not export ${target}: ${formatError(error)}`);
    await ctx.logger.error("terminal.deck", error, { target });
    return 1;
  }
}
