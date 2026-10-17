// Names the PDF a successful build leaves next to a root file.
import * as path from "node:path";

import type { ProjectEntry } from "../../project/index.js";

/** `root` is project-relative with "/" separators; undefined when the project has no root to build. */
export function builtPdfPath(project: Extract<ProjectEntry, { kind: "ready" }>, root: string | undefined = project.main): string | undefined {
  if (!root) { return undefined; }
  const { dir, name } = path.posix.parse(root);
  return path.join(project.folder, dir, `${name}.pdf`);
}
