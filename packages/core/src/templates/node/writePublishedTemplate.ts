// Saves the exact submitted template with its compiled previews into My templates atomically.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ensureCiteKey } from "../../library/index.js";
import { resolveInLibrary } from "../../bridge/node/index.js";
import type { PublishFile } from "../publishCheckReport.js";
import { serializeTemplateManifest, deriveTemplatePathProblem, type TemplateManifest } from "../templateManifest/index.js";

export async function writePublishedTemplate(libraryRoot: string, manifest: TemplateManifest, files: readonly PublishFile[]): Promise<void> {
  const templates = await resolveInLibrary(libraryRoot, "templates");
  await fs.mkdir(templates, { recursive: true });
  const names = await fs.readdir(templates);
  const id = await ensureCiteKey(manifest.id, names, async (name) => {
    try { await fs.lstat(path.join(templates, name)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  });
  const stagingRoot = await resolveInLibrary(libraryRoot, ".research/staging");
  await fs.mkdir(stagingRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(stagingRoot, "template-"));
  try {
    for (const file of files) {
      const problem = deriveTemplatePathProblem(file.path);
      if (problem) throw new Error(problem);
      const target = path.join(staging, ...file.path.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.path === "template.yaml" ? serializeTemplateManifest({ ...manifest, id }) : file.bytes);
    }
    const destination = await resolveInLibrary(libraryRoot, `templates/${id}`);
    try { await fs.lstat(destination); throw new Error(`Template "${id}" already exists`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await fs.rename(staging, destination);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
