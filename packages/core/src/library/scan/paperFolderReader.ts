/** Reads one paper folder: its record from metadata.yaml, the metadata's mtime and the PDF size. */
import type { PaperRecord } from "../../model/index.js";
import { METADATA_FILE } from "../layout.js";
import { paperRecordFromMetadata, parsePaperMetadata } from "../paperMetadata.js";
import type { PaperFolder } from "./folderLevel.js";
import { errorMessage, warnSkipped, type ScanEnv } from "./scanEnv.js";

export interface PaperRead {
  record: PaperRecord;
  modifiedMs: number;
  pdfBytes?: number;
}

/** @returns the paper, or undefined (after a warning) when metadata.yaml cannot be read or is not a YAML mapping */
export async function readPaperFolder(env: ScanEnv, folder: PaperFolder): Promise<PaperRead | undefined> {
  let text: string;
  try {
    text = await env.limit(() => env.fs.readText(env.ops.join(folder.path, METADATA_FILE)));
  } catch (error) {
    await warnSkipped(env, "Paper skipped: metadata.yaml could not be read", { folder: folder.path, message: errorMessage(error) });
    return undefined;
  }
  const meta = parsePaperMetadata(text);
  if (!meta) {
    await warnSkipped(env, "Paper skipped: metadata.yaml is not a valid mapping", { folder: folder.path });
    return undefined;
  }
  const record = paperRecordFromMetadata(meta, { id: env.ops.basename(folder.path), path: folder.path, hasPdf: folder.pdf !== undefined });
  return { record, modifiedMs: folder.metadata.mtimeMs, ...(folder.pdf ? { pdfBytes: folder.pdf.size } : {}) };
}
