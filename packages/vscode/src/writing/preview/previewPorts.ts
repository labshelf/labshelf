// Answers the reader's requests from a build preview: opens the source at the first build error or behind a double-click, and names the papers it cites.
import type { PathOps, PreviewPorts, LocatedProblem } from "@labshelf/core";
import { PREVIEW_LOG_MODULE } from "./previewStrings.js";
import { lookupCitation, openCitedPaper, type PreviewCitationDeps } from "./citations/index.js";
import { openSourceLine, showSource } from "./sourceLinks/index.js";

export interface PreviewPortsDeps extends PreviewCitationDeps {
  /** The problems of the project's last build. */
  problems: () => readonly LocatedProblem[];
  paths: PathOps;
}

/** The problem a failed-build banner jumps to: the first error, or the first problem when the build reported only warnings. */
function firstProblem(problems: readonly LocatedProblem[]): LocatedProblem | undefined {
  return problems.find((problem) => problem.severity === "error") ?? problems[0];
}

async function showBuildProblem(deps: PreviewPortsDeps): Promise<void> {
  const problem = firstProblem(deps.problems());
  if (!problem) {
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Build banner clicked without a stored problem", { projectFolder: deps.projectFolder });
    return;
  }
  const line = problem.line ?? 1;
  await openSourceLine(problem.file, line);
  await deps.logger.log("INFO", PREVIEW_LOG_MODULE, "Opened build problem", { projectFolder: deps.projectFolder, file: problem.file, line });
}

export function createPreviewPorts(deps: PreviewPortsDeps): PreviewPorts {
  return {
    showBuildProblem: () => showBuildProblem(deps),
    showSource: (point) => showSource(deps, point),
    lookupCitation: (query) => lookupCitation(deps, query),
    openCitedPaper: (paperId) => openCitedPaper(deps, paperId),
  };
}
