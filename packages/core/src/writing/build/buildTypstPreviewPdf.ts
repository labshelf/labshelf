// Names the PDF a Typst root's live preview shows, kept in the root's build folder apart from the saved <root>.pdf.
import type { PathOps } from "../../library/mutations/index.js";
import type { ProjectEntry } from "../project/index.js";
import { rootBuildFolder } from "../project/buildRoot/index.js";
import type { ProjectDataPort } from "../service/index.js";

/** `root` is the compiled file relative to the project folder. */
export function buildTypstPreviewPdf(
  project: Extract<ProjectEntry, { kind: "ready" }>,
  root: string,
  data: Pick<ProjectDataPort, "projectBuildDir">,
  paths: Pick<PathOps, "join" | "basename" | "extname">,
): string {
  const folder = paths.join(data.projectBuildDir(project.settings.id), rootBuildFolder(root));
  return paths.join(folder, `${paths.basename(root, paths.extname(root))}.pdf`);
}
