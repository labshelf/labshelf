// Remembers each mirrored file's hash with the size and mtime it had, so a sync rehashes only files that changed on disk.
import { readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type { ILogger } from "@labshelf/core";

import type { DiskFile } from "./mirrorFiles.js";

export interface IndexEntry extends DiskFile { sha256: string }
export type MirrorIndex = Map<string, IndexEntry>;

const MODULE = "helper/mirror";

function isEntry(value: unknown): value is IndexEntry {
  const entry = value as Partial<IndexEntry> | null;
  return typeof entry === "object" && entry !== null && typeof entry.sha256 === "string"
    && typeof entry.size === "number" && typeof entry.mtimeMs === "number";
}

/** The saved index of `projectDir`; a missing or unreadable file gives an empty index, so the next sync rehashes. */
export async function loadIndex(projectDir: string, logger: ILogger): Promise<MirrorIndex> {
  const file = path.join(projectDir, "mirror-index.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") { await logger.error(MODULE, error, { file }); }
    return new Map();
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return new Map(Object.entries(parsed).filter((pair): pair is [string, IndexEntry] => isEntry(pair[1])));
  } catch (error) {
    await logger.log("WARN", MODULE, "Mirror index is unreadable; files will be rehashed", { file, message: (error as Error).message });
    return new Map();
  }
}

export async function saveIndex(projectDir: string, index: MirrorIndex): Promise<void> {
  const file = path.join(projectDir, "mirror-index.json");
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(Object.fromEntries(index)));
  await rename(temp, file);
}
