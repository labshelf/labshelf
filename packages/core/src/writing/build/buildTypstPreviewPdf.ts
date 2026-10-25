// Names the PDF a Typst root's live preview shows, kept in the root's build folder apart from the saved <root>.pdf.
import type { PathOps } from "../../library/mutations/index.js";
import type { ProjectEntry } from "../project/index.js";
import { deriveBuildRootFolder } from "../project/buildRoot/index.js";
import type { ProjectContentPort } from "../service/index.js";

/** `root` is the compiled file relative to the project folder. */
export function buildTypstPreviewPdf(
  project: Extract<ProjectEntry, { kind: "ready" }>,
  root: string,
  data: Pick<ProjectContentPort, "projectBuildDir">,
  paths: Pick<PathOps, "join" | "basename" | "extname">,
): string {
  const folder = paths.join(data.projectBuildDir(project.settings.id), deriveBuildRootFolder(root));
  return paths.join(folder, `${paths.basename(root, paths.extname(root))}.pdf`);
}
