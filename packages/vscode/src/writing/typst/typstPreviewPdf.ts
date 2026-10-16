// Names the PDF a Typst root's live preview shows, kept in the root's build folder apart from the saved <root>.pdf.
import { rootBuildFolder, type PathOps, type ProjectDataPort } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";

/** `root` is the compiled file relative to the project folder. */
export function typstPreviewPdf(
  project: ReadyProject,
  root: string,
  data: Pick<ProjectDataPort, "projectBuildDir">,
  paths: Pick<PathOps, "join" | "basename" | "extname">,
): string {
  const folder = paths.join(data.projectBuildDir(project.settings.id), rootBuildFolder(root));
  return paths.join(folder, `${paths.basename(root, paths.extname(root))}.pdf`);
}
