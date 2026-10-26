/** Reads a catalog's downloads.json, the per-template download counts written by a scheduled CI job. */
// CONTRACT: documents/contracts/templates.md#community-catalog

import * as fs from "node:fs";
import * as path from "node:path";

import { isDownloadCount } from "../../templateManifest/index.js";

/** Counts by template id, or an empty map when `<root>/downloads.json` is missing; throws naming the file when it is invalid. */
export async function readDownloadCounts(root: string): Promise<Map<string, number>> {
  const file = path.join(root, "downloads.json");
  const text = await fs.promises.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return undefined; }
    throw new Error(`downloads.json: cannot be read (${error.message})`);
  });
  if (text === undefined) { return new Map(); }
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) {
    throw new Error(`downloads.json: is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("downloads.json: must be an object mapping template id to a download count");
  }
  const counts = new Map<string, number>();
  for (const [id, count] of Object.entries(value)) {
    if (!isDownloadCount(count)) { throw new Error(`downloads.json: "${id}" must be a non-negative integer`); }
    counts.set(id, count);
  }
  return counts;
}
