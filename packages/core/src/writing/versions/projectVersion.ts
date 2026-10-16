/** Describes one snapshot a project holds: its version.json fields plus where its PDF and sources are. */
import type { VersionInfo } from "./versionInfo.js";

export interface ProjectVersion extends VersionInfo {
  pdfPath: string;
  sourcesDir: string;
}
