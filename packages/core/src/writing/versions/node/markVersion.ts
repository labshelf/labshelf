// Snapshots a project's sources and built PDF into a named version, replacing a version of the same name.
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { listProjectFiles } from "../../project/node/index.js";
import type { MarkVersionRequest } from "../projectVersion.js";
import { serializeVersionFile, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES } from "../versionInfo.js";
import { versionSlug } from "../versionSlug.js";

const MODULE = "writing/versions";

async function copyInto(source: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function writeSnapshot(request: MarkVersionRequest, dir: string): Promise<number> {
  const pdf = path.resolve(request.pdfPath);
  const sources = (await listProjectFiles(request.folder)).filter((file) => path.resolve(file) !== pdf);
  await Promise.all(sources.map((file) =>
    copyInto(file, path.join(dir, VERSION_SOURCES, path.relative(request.folder, file)))));
  await copyInto(pdf, path.join(dir, VERSION_PDF));
  await fs.writeFile(path.join(dir, VERSION_FILE), serializeVersionFile({ name: request.name, created: request.now.toISOString() }));
  return sources.length;
}

/**
 * Builds the snapshot in a temp folder and renames it into place, so a failure never leaves a half-written version.
 * @throws when the name has no letter or digit, the PDF is missing, or a file cannot be copied
 */
export async function markVersion(request: MarkVersionRequest, logger: ILogger): Promise<string> {
  const slug = versionSlug(request.name);
  if (!slug) { throw new Error(`The version name "${request.name}" has no letter or digit to name its folder.`); }
  await fs.access(request.pdfPath).catch((cause: unknown) => {
    throw new Error(`Cannot mark a version without the built PDF at ${request.pdfPath}`, { cause });
  });
  const versions = path.join(request.folder, VERSIONS_DIR);
  const temp = path.join(versions, `.${slug}.tmp-${randomBytes(4).toString("hex")}`);
  const target = path.join(versions, slug);
  try {
    const files = await writeSnapshot(request, temp);
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(temp, target);
    await logger.log("INFO", MODULE, "Marked a version", { folder: request.folder, slug, files });
  } catch (cause) {
    await fs.rm(temp, { recursive: true, force: true });
    throw new Error(`Cannot mark version "${request.name}" of ${request.folder}`, { cause });
  }
  return target;
}
