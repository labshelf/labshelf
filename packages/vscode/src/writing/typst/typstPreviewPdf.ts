// Names the PDF a Typst project's live preview shows, kept in the build folder apart from the saved <main>.pdf.
import type { PathOps, ProjectDataPort } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";

export function typstPreviewPdf(
  project: ReadyProject & { main: string },
  data: Pick<ProjectDataPort, "projectBuildDir">,
  paths: Pick<PathOps, "join" | "basename" | "extname">,
): string {
  return paths.join(data.projectBuildDir(project.settings.id), `${paths.basename(project.main, paths.extname(project.main))}.pdf`);
}
