// Finds the PDF the preview shows for a root: for LaTeX the one its last successful build left next to the root file, for Typst the last live compile.
import { builtPdfPath, typstPreviewPdf } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";
import type { WritingProjects } from "../session/index.js";

/** The PDF's path, or `undefined` when there is no root or it has not been built. */
export async function builtPdf(projects: Pick<WritingProjects, "data" | "paths" | "fs">, project: ReadyProject | undefined, root: string | undefined): Promise<string | undefined> {
  if (!project || !root) { return undefined; }
  // INVARIANT: `root` is project-relative with "/" separators on every platform.
  const pdf = project.settings.format === "typst"
    ? typstPreviewPdf(project, root, projects.data, projects.paths)
    : builtPdfPath(projects.paths, project, root);
  if (!pdf) { return undefined; }
  // PLATFORM: the Typst preview sits in the build folder, which the web build keeps in extension storage rather than under file:.
  return await projects.fs.exists(pdf).then((found) => (found ? pdf : undefined), () => undefined);
}
