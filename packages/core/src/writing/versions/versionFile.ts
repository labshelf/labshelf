// Reads and writes the version.json of a snapshot, which comes from a synced folder and is validated on read.
// CONTRACT: documents/contracts/library-format.md#labshelfversions
import { parseJsonObject } from "../project/index.js";

/** Where a project keeps its version snapshots, relative to the project folder. */
export const VERSIONS_DIR = ".labshelf/versions";
export const VERSION_FILE = "version.json";
export const VERSION_PDF = "paper.pdf";
export const VERSION_SOURCES = "sources";

export interface VersionEntry {
  /** The snapshot's folder name under `.labshelf/versions/`. */
  slug: string;
  /** The name the user gave it. */
  name: string;
  /** ISO 8601 UTC timestamp. */
  created: string;
}

/** @returns undefined when the text is not a JSON object with a non-empty name and a valid created timestamp */
export function parseVersionFile(slug: string, text: string): VersionEntry | undefined {
  const raw = parseJsonObject(text);
  if (!raw) { return undefined; }
  const { name, created } = raw;
  if (typeof name !== "string" || name.trim() === "") { return undefined; }
  if (typeof created !== "string" || Number.isNaN(Date.parse(created))) { return undefined; }
  return { slug, name, created };
}

export function serializeVersionFile(version: Pick<VersionEntry, "name" | "created">): string {
  return `${JSON.stringify({ name: version.name, created: version.created }, null, 2)}\n`;
}
