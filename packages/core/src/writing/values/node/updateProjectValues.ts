/** Regenerates a LaTeX project's labshelf-values.tex next to its main file and loads it from the main file. */
// CONTRACT: documents/contracts/library-format.md#labshelf-valuestex

import * as path from "node:path";

import { nodeProjectReadContext } from "../../project/node/index.js";
import { readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { OpenSources } from "../../project/index.js";
import { readProjectValues } from "../readProjectValues.js";
import type { ValueLeaf } from "../valueLeaves.js";
import { VALUES_FILE_NAME, generateValuesFile } from "../valuesFile.js";
import { withValuesInput } from "../valuesInputLine.js";
import type { ValueProject } from "../valueLeaves.js";

const MODULE = "writing/values";

export interface ValuesUpdate {
  /** True when labshelf-values.tex was written; an unchanged file is not rewritten. */
  written: boolean;
  leaves: ValueLeaf[];
  mainLine: "present" | "added" | "no-main" | "no-document" | "not-needed";
}

async function addMainLine(mainPath: string, logger: ILogger, open: OpenSources | undefined): Promise<ValuesUpdate["mainLine"]> {
  const text = open?.text(mainPath) ?? await readOptionalFile(mainPath);
  if (text === undefined) { return "no-main"; }
  const result = withValuesInput(text);
  // An open main file is edited in the editor, so the user's unsaved changes and undo history survive.
  if (result.kind === "added" && !await open?.replace(mainPath, result.text)) { await writeFileAtomic(mainPath, result.text); }
  if (result.kind === "no-document") { await logger.log("WARN", MODULE, "main file has no \\begin{document} to load the values before", { main: mainPath }); }
  return result.kind;
}

/** Writes labshelf-values.tex for the project's current value files; only a LaTeX project with `values:` has one. */
export async function updateProjectValues(project: ValueProject, logger: ILogger, open?: OpenSources): Promise<ValuesUpdate> {
  if (project.settings.format !== "latex" || !project.settings.values?.length) { return { written: false, leaves: [], mainLine: "not-needed" }; }
  if (project.main === undefined) { return { written: false, leaves: [], mainLine: "no-main" }; }
  const leaves = await readProjectValues(project, nodeProjectReadContext(logger));
  const mainPath = path.join(project.folder, project.main);
  const valuesPath = path.join(path.dirname(mainPath), VALUES_FILE_NAME);
  const text = generateValuesFile(leaves);
  const written = await readOptionalFile(valuesPath) !== text;
  if (written) { await writeFileAtomic(valuesPath, text); }
  const mainLine = await addMainLine(mainPath, logger, open);
  if (written || mainLine === "added") {
    await logger.log("INFO", MODULE, "project values updated", { project: project.settings.id, values: leaves.length, mainLine });
  }
  return { written, leaves, mainLine };
}
