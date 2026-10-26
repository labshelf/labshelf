// Generates project value macros through the host project writer.
// CONTRACT: documents/contracts/library-format.md#generated-files

import * as path from "node:path";

import { createNodeProjectReadCompositionRoot } from "../../project/node/index.js";
import { readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger, LibraryFileSystem } from "../../../ports/index.js";
import type { OpenSources } from "../../project/index.js";
import { readProjectValues } from "../readProjectValues.js";
import type { ProjectValueLeaf } from "../projectValueLeaves.js";
import { VALUES_FILE_NAME, createProjectValueFile } from "../projectValueFile.js";
import { withProjectValueInput } from "../projectValueInputLine.js";
import type { ProjectValueSource } from "../projectValueLeaves.js";

const MODULE = "writing/projectValue";

export interface ProjectValueUpdate {
  /** True when labshelf-values.tex was written; an unchanged file is not rewritten. */
  written: boolean;
  leaves: ProjectValueLeaf[];
  mainLine: "present" | "added" | "no-main" | "no-document" | "not-needed";
}

async function addMainLine(mainPath: string, logger: ILogger, open: OpenSources | undefined, writer: Pick<LibraryFileSystem, "writeText">): Promise<ProjectValueUpdate["mainLine"]> {
  const text = open?.text(mainPath) ?? await readOptionalFile(mainPath);
  if (text === undefined) { return "no-main"; }
  const result = withProjectValueInput(text);
  // An open main file is edited in the editor, so the user's unsaved changes and undo history survive.
  if (result.kind === "added" && !await open?.replace(mainPath, result.text)) { await writer.writeText(mainPath, result.text); }
  if (result.kind === "no-document") { await logger.log("WARN", MODULE, "main file has no \\begin{document} to load the values before", { main: mainPath }); }
  return result.kind;
}

/** Writes labshelf-values.tex for the project's current value files; only a LaTeX project with `values:` has one. */
export async function updateProjectValues(project: ProjectValueSource, logger: ILogger, open?: OpenSources, writer: Pick<LibraryFileSystem, "writeText"> = { writeText: writeFileAtomic }): Promise<ProjectValueUpdate> {
  if (project.settings.format !== "latex" || !project.settings.values?.length) { return { written: false, leaves: [], mainLine: "not-needed" }; }
  if (project.main === undefined) { return { written: false, leaves: [], mainLine: "no-main" }; }
  const leaves = await readProjectValues(project, createNodeProjectReadCompositionRoot(logger));
  const mainPath = path.join(project.folder, project.main);
  const valuesPath = path.join(path.dirname(mainPath), VALUES_FILE_NAME);
  const text = createProjectValueFile(leaves);
  const written = await readOptionalFile(valuesPath) !== text;
  if (written) { await writer.writeText(valuesPath, text); }
  const mainLine = await addMainLine(mainPath, logger, open, writer);
  if (written || mainLine === "added") {
    await logger.log("INFO", MODULE, "project values updated", { project: project.settings.id, values: leaves.length, mainLine });
  }
  return { written, leaves, mainLine };
}
