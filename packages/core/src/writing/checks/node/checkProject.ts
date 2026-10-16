/** Runs the pre-submission check on a project folder and its built PDF. */
import { promises as fs } from "node:fs";

import type { PdfjsLoader } from "../../../import/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { CheckSettings } from "../../project/index.js";
import { listProjectFiles } from "../../project/node/index.js";
import type { CheckFinding, CheckSource } from "../checkTypes.js";
import { runChecks } from "../runChecks.js";
import { gitUserName } from "./gitUserName.js";
import { readPdfFacts } from "./readPdfFacts.js";

const MODULE = "writing/checks";
const SOURCE_FILE = /\.(?:tex|typ)$/;

export interface ProjectCheck {
  /** The project folder. */
  folder: string;
  /** The built PDF to check. */
  pdfPath: string;
  settings: CheckSettings | undefined;
}

async function readSources(folder: string): Promise<CheckSource[]> {
  const files = (await listProjectFiles(folder)).filter((file) => SOURCE_FILE.test(file)).sort();
  return Promise.all(files.map(async (file) => ({ file, lines: (await fs.readFile(file, "utf8")).split(/\r?\n/) })));
}

/** Source files are absolute paths in the findings. A PDF that cannot be read rejects, with the path in the log. */
export async function checkProject(check: ProjectCheck, pdfjs: PdfjsLoader, logger: ILogger): Promise<CheckFinding[]> {
  const context = { folder: check.folder, pdf: check.pdfPath };
  try {
    const [facts, sources, gitUser] = await Promise.all([readPdfFacts(pdfjs, check.pdfPath), readSources(check.folder), gitUserName(check.folder)]);
    const findings = runChecks({ facts, sources, settings: check.settings, gitUser });
    await logger.log("INFO", MODULE, "Checked the project before submitting", {
      ...context, pages: facts.pages.length, sources: sources.length, gitUser: gitUser !== undefined, findings: findings.length,
    });
    return findings;
  } catch (error) {
    await logger.error(MODULE, error, context);
    throw error;
  }
}
