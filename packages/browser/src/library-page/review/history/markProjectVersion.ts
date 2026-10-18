// Marks a version of the project from its last built PDF after asking its name, and keeps the milestone in the history.
import { listVersions, markVersion, posixPathOps, recordSnapshot, versionSlug, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { confirmDialog, inputBox, toast } from "@labshelf/core/dom";
import { projectHistoryTarget } from "./historyTarget";

const TEMP_PDF = ".labshelf/tmp-version.pdf";

export interface MarkProjectVersionDeps {
  fs: LibraryFileSystem;
  logger: ILogger;
  /** The PDF of the last full build of the project, if it was built in this page session. */
  lastFullPdf(projectId: string): Uint8Array | undefined;
}

async function confirmReplace(deps: MarkProjectVersionDeps, folder: string, name: string): Promise<boolean> {
  const context = { fs: deps.fs, paths: posixPathOps, logger: deps.logger };
  const slug = versionSlug(name);
  const existing = (await listVersions(context, folder)).find((version) => version.slug === slug);
  if (!existing) return true;
  return confirmDialog(`Replace version “${existing.name}”?`, "Its sources and PDF are replaced by the current ones.", "Replace", true);
}

/** @returns true when a version was marked; false when it was cancelled or there is no built PDF yet */
export async function markProjectVersion(deps: MarkProjectVersionDeps, { id, folder }: { id: string; folder: string }): Promise<boolean> {
  const { fs, logger } = deps;
  const pdf = deps.lastFullPdf(id);
  if (!pdf) {
    toast("Build the project once with LabShelf Helper to mark a version.");
    return false;
  }
  const typed = await inputBox({ title: "Mark Version", prompt: "Name of the version", validate: (value) => (versionSlug(value) ? null : "Use at least one letter or digit.") });
  const name = typed?.trim();
  if (!name || !(await confirmReplace(deps, folder, name))) return false;
  const pdfPath = posixPathOps.join(folder, TEMP_PDF);
  try {
    await fs.writeFile(pdfPath, pdf);
    await markVersion({ fs, paths: posixPathOps, logger }, { folder, pdfPath, name, now: new Date() });
  } finally {
    await fs.deleteFile(pdfPath).catch((error: unknown) => logger.error("library-page.history", error, { action: "remove temp version PDF", pdfPath }));
  }
  await recordSnapshot(projectHistoryTarget(fs, folder, id), "version", logger, name);
  toast(`Marked version “${name}”.`, "ok");
  return true;
}
