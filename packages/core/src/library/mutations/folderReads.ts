/** Reads what is on disk right now for a mutation: a paper folder's metadata.yaml and reading status, and the PDF files
 * an import pick (files and folders) expands to, searching folders below the picked ones and skipping hidden entries
 * and symlinks. */
import { formatError } from "../../errors/index.js";
import { isReadingStatus, createPaperRecord, parsePaperMetadata } from "../record.js";
import { METADATA_FILE } from "../layout.js";
import type { PaperRecord } from "../../model/index.js";
import type { MutationContext } from "./paperRecordWrite.js";

export const MUTATIONS_MODULE = "library/mutations";

// --- Paper folder ---

/** @returns the reading status metadata.yaml holds and when it changed, or undefined when it cannot be read or holds no status */
export async function readReadingStatusOnFileSystem(ctx: MutationContext, folder: string): Promise<Pick<PaperRecord, "status" | "statusChangedAt"> | undefined> {
  const meta = await readMetadata(ctx, folder);
  if (!meta || !isReadingStatus(meta["status"])) { return undefined; }
  const { status, statusChangedAt } = createPaperRecord(meta, { id: "", path: folder, hasPdf: false });
  return statusChangedAt === undefined ? { status } : { status, statusChangedAt };
}

export async function readMetadata(ctx: MutationContext, folder: string): Promise<Record<string, unknown> | undefined> {
  const file = ctx.paths.join(folder, METADATA_FILE);
  if (!(await ctx.fs.exists(file))) { return undefined; }
  return parsePaperMetadata(await ctx.fs.readText(file));
}

// --- PDF discovery ---

export interface PdfDiscovery {
  /** Files picked directly, whatever their extension, and the .pdf files inside picked folders. */
  pdfs: string[];
  /** Inputs that are neither a file nor a folder: missing paths and symlinks. */
  skipped: string[];
}

/** @returns the PDFs to import, in input order with each folder's files sorted, and the skipped inputs */
export async function findPdfsToImport(ctx: MutationContext, inputs: string[]): Promise<PdfDiscovery> {
  const found: PdfDiscovery = { pdfs: [], skipped: [] };
  for (const input of inputs) {
    const stat = await ctx.fs.stat(input);
    if (stat?.isDirectory) {
      found.pdfs.push(...(await pdfsUnder(ctx, input)).sort());
    } else if (stat?.isFile) {
      found.pdfs.push(input);
    } else {
      found.skipped.push(input);
    }
  }
  return found;
}

// Dot entries are hidden folders and system files; a symlink stats as neither file nor folder and is left out.
async function pdfsUnder(ctx: MutationContext, dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await ctx.fs.listDir(dir);
  } catch (error) {
    await ctx.logger.log("WARN", MUTATIONS_MODULE, "Import skipped a folder it could not read", {
      dir, message: formatError(error),
    });
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith(".")) { continue; }
    const child = ctx.paths.join(dir, name);
    const stat = await ctx.fs.stat(child);
    if (stat?.isDirectory) {
      out.push(...(await pdfsUnder(ctx, child)));
    } else if (stat?.isFile && name.toLowerCase().endsWith(".pdf")) {
      out.push(child);
    }
  }
  return out;
}
