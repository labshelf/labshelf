// Shows a LaTeX project's built PDF in the side pane: the one on disk when the page opens, then each one a build writes.
import type { ILogger } from "@labshelf/core";
import { ProjectFileNotFoundError, type BrowserProjects } from "../../storage/projects";
import type { SidePane } from "./sidePane";

const MODULE = "browser.editor.latexPreview";

export interface LatexPreviewDeps {
  projects: Pick<BrowserProjects, "readProjectFile">;
  projectId: string;
  /** The built PDF, relative to the project folder. */
  pdf: string;
  pane: Pick<SidePane, "reveal" | "status">;
  /** Draws the PDF's pages; the previous pages stay when it throws. */
  render(bytes: Uint8Array): Promise<void>;
  logger: ILogger;
  /** Hears the project-relative path of every file written, including the PDF the extension writes after a build. */
  onFileWritten(listener: (relative: string) => void): void;
}

async function showPdf(deps: LatexPreviewDeps): Promise<void> {
  const { projects, projectId, pdf, pane, logger } = deps;
  let bytes: Uint8Array;
  try {
    bytes = await projects.readProjectFile(projectId, pdf);
  } catch (error) {
    if (!(error instanceof ProjectFileNotFoundError)) {
      pane.status("The PDF could not be shown; see the log.");
      await logger.error(MODULE, error, { project: projectId, pdf, action: "read the PDF" });
      return;
    }
    pane.status("No PDF yet; it shows after the first build.");
    return;
  }
  try {
    await deps.render(bytes);
    pane.status("");
    await logger.log("INFO", MODULE, "Showed the LaTeX PDF", { project: projectId, pdf, bytes: bytes.length });
  } catch (error) {
    pane.status("The PDF could not be shown; see the log.");
    await logger.error(MODULE, error, { project: projectId, pdf, action: "draw the PDF" });
  }
}

export async function startLatexPreview(deps: LatexPreviewDeps): Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  let pending = false;
  // INVARIANT: one draw at a time; writes during a draw collapse into one more draw of the newest file.
  const show = (): Promise<void> => {
    if (pending) return chain;
    pending = true;
    chain = chain.then(() => { pending = false; return showPdf(deps); });
    return chain;
  };
  deps.pane.reveal();
  deps.onFileWritten((relative) => { if (relative === deps.pdf) void show(); });
  await show();
}
