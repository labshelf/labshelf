// Checks LabShelf Helper when the page opens a LaTeX project and shows its setup when the helper or TeX is missing.
import type { ILogger, ProjectFormat } from "@labshelf/core";
import type { HelperStatus, ILatexHelper } from "@labshelf/core/helper";

const MODULE = "editor.helperCheck";

export interface LatexHelperCheckDeps {
  helper: Pick<ILatexHelper, "connect">;
  logger: ILogger;
  showHelperSetup(): void;
  format: ProjectFormat;
  projectId: string;
}

// The user should learn that LaTeX needs the helper on opening the project, not on the first build that does nothing.
export async function checkLatexHelper({ helper, logger, showHelperSetup, format, projectId }: LatexHelperCheckDeps): Promise<void> {
  if (format !== "latex") return;
  let status: HelperStatus | undefined;
  try {
    status = await helper.connect();
  } catch (error) {
    await logger.error(MODULE, error, { project: projectId, action: "connect to LabShelf Helper" });
  }
  if (status?.state === "ready" && status.tex.source !== "none") return;
  await logger.log("INFO", MODULE, "LabShelf Helper or TeX is missing; showing the setup", { project: projectId, state: status?.state ?? "unreachable" });
  showHelperSetup();
}
