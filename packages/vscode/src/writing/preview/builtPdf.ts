// Finds the PDF a LaTeX project's last successful build left next to its main file.
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ReadyProject } from "../mainDocument.js";

/** The built PDF's path, or `undefined` when the project is not a LaTeX project with a main file or has not been built. */
export async function builtPdf(project: ReadyProject | undefined): Promise<string | undefined> {
  if (project?.settings.format !== "latex" || !project.main) { return undefined; }
  const { dir, name } = path.parse(project.main);
  const pdf = path.join(project.folder, dir, `${name}.pdf`);
  return await fs.stat(pdf).then(() => pdf, () => undefined);
}
