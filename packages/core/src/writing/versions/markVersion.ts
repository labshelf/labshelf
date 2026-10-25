// Snapshots a project's sources and built PDF into a named version, replacing a version of the same name.
import { listProjectFiles, type ProjectReadContext } from "../project/folder/index.js";
import type { MarkVersionRequest } from "./projectVersion.js";
import { serializeVersionFile, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES } from "./versionFile.js";
import { versionSlug } from "./versionSlug.js";

const MODULE = "writing/versions";

function randomSuffix(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Copies one file at a time, so no write is still in flight when a failure removes the temp folder. */
async function writeSnapshot({ fs, paths }: ProjectReadContext, request: MarkVersionRequest, dir: string): Promise<number> {
  const pdf = paths.resolve(request.pdfPath);
  const sources = (await listProjectFiles({ fs, paths }, request.folder))
    .filter((relative) => paths.resolve(paths.join(request.folder, ...relative.split("/"))) !== pdf);
  for (const relative of sources) {
    const segments = relative.split("/");
    await fs.writeFile(paths.join(dir, VERSION_SOURCES, ...segments), await fs.readFile(paths.join(request.folder, ...segments)));
  }
  await fs.writeFile(paths.join(dir, VERSION_PDF), await fs.readFile(pdf));
  await fs.writeText(paths.join(dir, VERSION_FILE), serializeVersionFile({ name: request.name, created: request.now.toISOString() }));
  return sources.length;
}

/**
 * Builds the snapshot in a temp folder and renames it into place, so a failure never leaves a half-written version.
 * @throws when the name has no letter or digit, the PDF is missing, or a file cannot be copied
 */
export async function markVersion(context: ProjectReadContext, request: MarkVersionRequest): Promise<string> {
  const { fs, paths, logger } = context;
  const slug = versionSlug(request.name);
  if (!slug) { throw new Error(`The version name "${request.name}" has no letter or digit to name its folder.`); }
  if ((await fs.stat(request.pdfPath))?.isFile !== true) {
    throw new Error(`Cannot mark a version without the built PDF at ${request.pdfPath}`);
  }
  const versions = paths.join(request.folder, VERSIONS_DIR);
  const temp = paths.join(versions, `.${slug}.tmp-${randomSuffix()}`);
  const target = paths.join(versions, slug);
  try {
    const files = await writeSnapshot(context, request, temp);
    await fs.removeTree(target);
    await fs.rename(temp, target);
    await logger.log("INFO", MODULE, "Marked a version", { folder: request.folder, slug, files });
  } catch (cause) {
    await fs.removeTree(temp).catch((cleanup: unknown) => logger.error(MODULE, cleanup, { temp, action: "remove temp version" }));
    await logger.error(MODULE, cause, { folder: request.folder, temp, target });
    throw new Error(`Cannot mark version "${request.name}" of ${request.folder}`, { cause });
  }
  return target;
}
