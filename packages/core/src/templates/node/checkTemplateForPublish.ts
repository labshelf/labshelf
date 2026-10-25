/** Checks a writing project against the catalog rules and, when all pass, lays out the files of a submission. */
// CONTRACT: documents/contracts/templates.md#manifest

import { promises as fs } from "node:fs";
import { readTemplateFields, serializeTemplateManifest, type TemplateManifest } from "../templateManifest/index.js";
import type { PublishCheck, PublishCheckInput, PublishCheckReport, PublishFile } from "../publishCheckReport.js";
import { SAMPLE_MAX_BYTES, THUMBNAIL_MAX_BYTES, thumbnailProblem } from "./catalog/index.js";
import { runSourceChecks } from "./sourceChecks.js";
import type { FoundFile } from "./walkFolder.js";

/** @param projectFiles the files that passed the checks, laid out under `files/` */
async function layOutPublishFiles(
  manifest: TemplateManifest,
  projectFiles: readonly FoundFile[],
  thumbnail: Uint8Array,
  sample: Uint8Array,
): Promise<PublishFile[]> {
  const files: PublishFile[] = [{ path: "template.yaml", bytes: new TextEncoder().encode(serializeTemplateManifest(manifest)) }];
  for (const file of projectFiles) {
    files.push({ path: `files/${file.path}`, bytes: new Uint8Array(await fs.readFile(file.absolute)) });
  }
  files.push({ path: "preview/thumbnail.png", bytes: thumbnail }, { path: "preview/sample.pdf", bytes: sample });
  return files;
}

const MODULE = "templates";
const SKIPPED = "Skipped: an earlier check failed.";

const failed = (id: PublishCheck["id"], message: string): PublishCheck => ({ id, ok: false, message });

async function buildCheck(input: PublishCheckInput): Promise<{ check: PublishCheck; pdf?: Uint8Array }> {
  const { projectFolder, manifest, logger } = input;
  const context = { action: "publish check build", projectFolder, templateId: manifest.id, engine: manifest.engine };
  try {
    const built = await input.buildPdf();
    if (!built.ok) {
      const message = built.problems[0] ?? "The build failed.";
      await logger.error(MODULE, new Error(`build failed: ${message}`), { ...context, problems: built.problems });
      return { check: failed("build", message) };
    }
    if (built.pdf.byteLength > SAMPLE_MAX_BYTES) { return { check: failed("build", `The built PDF is over ${SAMPLE_MAX_BYTES} bytes.`) }; }
    return { check: { id: "build", ok: true }, pdf: built.pdf };
  } catch (error) {
    await logger.error(MODULE, error, context);
    return { check: failed("build", (error as Error).message) };
  }
}

async function thumbnailCheck(input: PublishCheckInput, pdf: Uint8Array): Promise<{ check: PublishCheck; png?: Uint8Array }> {
  try {
    const png = await input.renderThumbnail(pdf);
    const problem = png.byteLength > THUMBNAIL_MAX_BYTES ? `thumbnail.png is over ${THUMBNAIL_MAX_BYTES} bytes` : thumbnailProblem(png);
    return problem === undefined ? { check: { id: "thumbnail", ok: true }, png } : { check: failed("thumbnail", problem) };
  } catch (error) {
    await input.logger.error(MODULE, error, { action: "publish check thumbnail", projectFolder: input.projectFolder, templateId: input.manifest.id });
    return { check: failed("thumbnail", (error as Error).message) };
  }
}

/**
 * Runs the cheap checks first, the manifest among them, and builds only when they all pass, so a refused project never runs a compiler.
 * @returns all seven checks in display order
 */
export async function checkTemplateForPublish(input: PublishCheckInput): Promise<PublishCheckReport> {
  const { checks: sourceChecks, files } = await runSourceChecks(input.projectFolder, input.manifest);
  const parsed = readTemplateFields({ ...input.manifest });
  const manifestCheck: PublishCheck = parsed.ok ? { id: "manifest", ok: true } : failed("manifest", parsed.reason);
  const checks: PublishCheck[] = [manifestCheck, ...sourceChecks];
  if (!parsed.ok) { return { checks, ok: false }; }
  if (!sourceChecks.every((c) => c.ok) || files === undefined) {
    checks.push(failed("build", SKIPPED), failed("thumbnail", SKIPPED));
    return { checks, ok: false };
  }
  const build = await buildCheck(input);
  checks.push(build.check);
  if (build.pdf === undefined) {
    checks.push(failed("thumbnail", SKIPPED));
    return { checks, ok: false };
  }
  const thumbnail = await thumbnailCheck(input, build.pdf);
  checks.push(thumbnail.check);
  if (thumbnail.png === undefined) { return { checks, ok: false }; }
  const layout = await layOutPublishFiles(input.manifest, files, thumbnail.png, build.pdf);
  return { checks, ok: true, files: layout, thumbnail: thumbnail.png, sample: build.pdf };
}
