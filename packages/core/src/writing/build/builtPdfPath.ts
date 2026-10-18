// Names the PDF a successful build leaves next to a root file.
import type { PathOps } from "../../library/index.js";
import type { ProjectEntry } from "../project/index.js";

/** `root` is project-relative with "/" separators; undefined when the project has no root to build. */
export function builtPdfPath(paths: Pick<PathOps, "join">, project: Extract<ProjectEntry, { kind: "ready" }>, root: string | undefined = project.main): string | undefined {
  if (!root) { return undefined; }
  const slash = root.lastIndexOf("/");
  const file = root.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  return paths.join(project.folder, root.slice(0, Math.max(slash, 0)), `${dot > 0 ? file.slice(0, dot) : file}.pdf`);
}
