// Finds the PDF a project's preview shows: for LaTeX the one its last successful build left next to the main file, for Typst the last live compile.
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ReadyProject } from "../mainDocument.js";
import { typstPreviewPdf } from "../typst/index.js";

/** The PDF's path, or `undefined` when the project has no main file or has not been built. */
export async function builtPdf(project: ReadyProject | undefined): Promise<string | undefined> {
  if (!project?.main) { return undefined; }
  const { dir, name } = path.parse(project.main);
  const pdf = project.settings.format === "typst" ? typstPreviewPdf({ ...project, main: project.main }) : path.join(project.folder, dir, `${name}.pdf`);
  return await fs.stat(pdf).then(() => pdf, () => undefined);
}
