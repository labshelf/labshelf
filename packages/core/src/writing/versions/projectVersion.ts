/** Describes one snapshot a project holds: its version.json fields plus where its PDF and sources are. */
import type { VersionEntry } from "./versionFile.js";

export interface ProjectVersion extends VersionEntry {
  pdfPath: string;
  sourcesDir: string;
}

export interface MarkVersionRequest {
  /** The project folder. */
  folder: string;
  /** The built PDF to keep with the sources. */
  pdfPath: string;
  name: string;
  now: Date;
}
