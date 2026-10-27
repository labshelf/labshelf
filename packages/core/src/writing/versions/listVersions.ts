// Lists the versions a project folder holds, oldest first, skipping snapshots that cannot be read.
import type { ProjectReadContext } from "../project/projectReads.js";
import { readOptionalText } from "../project/projectReads.js";
import type { ProjectVersion } from "./projectVersion.js";
import { parseVersionFile, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES } from "./versionFile.js";

const MODULE = "writing/versions";

async function readVersion({ fs, paths, logger }: ProjectReadContext, root: string, slug: string): Promise<ProjectVersion | undefined> {
  const dir = paths.join(root, slug);
  const info = await readOptionalText(fs, paths.join(dir, VERSION_FILE)).then((text) => text === undefined ? undefined : parseVersionFile(slug, text), () => undefined);
  if (!info) {
    await logger.log("WARN", MODULE, "Skipped a version with a missing or malformed version.json", { dir });
    return undefined;
  }
  return { ...info, pdfPath: paths.join(dir, VERSION_PDF), sourcesDir: paths.join(dir, VERSION_SOURCES) };
}

/** @returns the versions sorted by creation time; empty when the project has none */
export async function listVersions(context: ProjectReadContext, folder: string): Promise<ProjectVersion[]> {
  const { fs, paths } = context;
  const root = paths.join(folder, VERSIONS_DIR);
  const names: string[] = [];
  for (const name of await fs.listDir(root)) {
    if (!name.startsWith(".") && (await fs.stat(paths.join(root, name)))?.isDirectory) { names.push(name); }
  }
  const versions = (await Promise.all(names.map((slug) => readVersion(context, root, slug)))).filter((v) => v !== undefined);
  return versions.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
}
