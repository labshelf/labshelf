/** Reads one paper folder: its record from metadata.yaml, the metadata's mtime and the PDF size. */
import type { PaperRecord } from "../../model/index.js";
import { METADATA_FILE } from "../layout.js";
import { paperRecordFromMetadata, parsePaperMetadata } from "../paperMetadata.js";
import type { PaperFolder } from "./folderLevel.js";
import { errorMessage } from "../../logging/index.js";
import { warnSkipped, type ScanEnv } from "./scanEnv.js";

export interface PaperRead {
  record: PaperRecord;
  modifiedMs: number;
  pdfBytes?: number;
}

/** Keeps the last known paper for a metadata.yaml that fails, so a half-written file never removes it; the next scan reads it again. */
async function keepPreviousOrSkip(env: ScanEnv, folder: PaperFolder, reason: string, context: Record<string, unknown>): Promise<PaperRead | undefined> {
  const kept = env.previous.get(folder.path);
  if (!kept) {
    await warnSkipped(env, `Paper skipped: ${reason}`, { folder: folder.path, ...context });
    return undefined;
  }
  await warnSkipped(env, `Paper kept from the last scan: ${reason}`, { folder: folder.path, ...context });
  return { record: kept.record, modifiedMs: kept.modifiedMs, ...(kept.pdfBytes !== undefined ? { pdfBytes: kept.pdfBytes } : {}) };
}

/** @returns the paper; on a metadata.yaml that cannot be read or is not a YAML mapping, the previous entry, or undefined (after a warning) without one */
export async function readPaperFolder(env: ScanEnv, folder: PaperFolder): Promise<PaperRead | undefined> {
  let text: string;
  try {
    text = await env.limit(() => env.fs.readText(env.ops.join(folder.path, METADATA_FILE)));
  } catch (error) {
    return keepPreviousOrSkip(env, folder, "metadata.yaml could not be read", { message: errorMessage(error) });
  }
  const meta = parsePaperMetadata(text);
  if (!meta) { return keepPreviousOrSkip(env, folder, "metadata.yaml is not a valid mapping", {}); }
  const record = paperRecordFromMetadata(meta, { id: env.ops.basename(folder.path), path: folder.path, hasPdf: folder.pdf !== undefined });
  return { record, modifiedMs: folder.metadata.mtimeMs, ...(folder.pdf ? { pdfBytes: folder.pdf.size } : {}) };
}
