// Reads and writes the version.json of a snapshot, which comes from a synced folder and is validated on read.
// CONTRACT: documents/contracts/library-format.md#labshelfversions

/** Where a project keeps its version snapshots, relative to the project folder. */
export const VERSIONS_DIR = ".labshelf/versions";
export const VERSION_FILE = "version.json";
export const VERSION_PDF = "paper.pdf";
export const VERSION_SOURCES = "sources";

export interface VersionInfo {
  /** The snapshot's folder name under `.labshelf/versions/`. */
  slug: string;
  /** The name the user gave it. */
  name: string;
  /** ISO 8601 UTC timestamp. */
  created: string;
}

/** @returns undefined when the text is not a JSON object with a non-empty name and a valid created timestamp */
export function parseVersionFile(slug: string, text: string): VersionInfo | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) { return undefined; }
  const { name, created } = raw as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") { return undefined; }
  if (typeof created !== "string" || Number.isNaN(Date.parse(created))) { return undefined; }
  return { slug, name, created };
}

export function serializeVersionFile(version: Pick<VersionInfo, "name" | "created">): string {
  return `${JSON.stringify({ name: version.name, created: version.created }, null, 2)}\n`;
}
