// Lists the versions a project folder holds, oldest first, skipping snapshots that cannot be read.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import type { ProjectVersion } from "../projectVersion.js";
import { parseVersionFile, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES, type VersionInfo } from "../versionInfo.js";

const MODULE = "writing/versions";

async function readVersion(root: string, slug: string, logger: ILogger): Promise<ProjectVersion | undefined> {
  const dir = path.join(root, slug);
  const info = await fs.readFile(path.join(dir, VERSION_FILE), "utf8").then((text) => parseVersionFile(slug, text), () => undefined);
  if (!info) {
    await logger.log("WARN", MODULE, "Skipped a version with a missing or malformed version.json", { dir });
    return undefined;
  }
  return { ...info, pdfPath: path.join(dir, VERSION_PDF), sourcesDir: path.join(dir, VERSION_SOURCES) };
}

/** @returns the versions sorted by creation time; empty when the project has none */
export async function listVersions(folder: string, logger: ILogger): Promise<ProjectVersion[]> {
  const root = path.join(folder, VERSIONS_DIR);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return []; }
    throw error;
  });
  const names = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
  const versions = (await Promise.all(names.map((slug) => readVersion(root, slug, logger)))).filter((v) => v !== undefined);
  return versions.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
}
