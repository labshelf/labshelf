// Runs `labshelf check`: checks a project's built PDF and sources for submission problems and prints them.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { formatError, deriveBuiltPdfPath, type CheckProblem, type ILogger } from "@labshelf/core";
import { checkProject, createPdfjsLoader, type ProjectCheck } from "@labshelf/core/node";

import type { AppContext } from "../compositionRoot.js";
import { findProject } from "./build/index.js";
import type { Output } from "./usage.js";

export type CheckContext = Pick<AppContext, "logger" | "paths">;

/** The check over one project; tests substitute it so they need no PDF. */
export type ProjectChecker = (check: ProjectCheck, logger: ILogger) => Promise<CheckProblem[]>;

const realChecker: ProjectChecker = (check, logger) => checkProject(check, createPdfjsLoader(), logger);

/** `path:line: severity: message` for a source finding; `main.pdf: page N: severity: message` for one in the PDF. */
function findingLine(finding: CheckProblem, pdfPath: string, cwd: string): string {
  const { location, severity, message } = finding;
  if (location.kind === "source") { return `${path.relative(cwd, location.file)}:${location.line}: ${severity}: ${message}`; }
  const pdf = path.relative(cwd, pdfPath);
  return location.page === undefined ? `${pdf}: ${severity}: ${message}` : `${pdf}: page ${location.page}: ${severity}: ${message}`;
}

const exists = (target: string) => fs.stat(target).then(() => true, () => false);

/**
 * @param positionals the project folder or id; absent means the project containing the working directory
 * @param flags `json` prints the findings array instead of text lines
 * @returns the exit code: 0 no findings, 1 findings or a failed check, 2 the project has no built PDF
 */
export async function runCheck(
  ctx: CheckContext, positionals: string[], flags: Record<string, string | boolean>, io: Output,
  check: ProjectChecker = realChecker,
): Promise<number> {
  const project = await findProject(ctx.paths.root, ctx.logger, positionals[0], process.cwd());
  const pdfPath = deriveBuiltPdfPath(path, project);
  if (!pdfPath) {
    io.err(`${project.folder} has no main file. Set main: in labshelf.yaml.`);
    return 1;
  }
  if (!(await exists(pdfPath))) {
    io.err(`${path.relative(process.cwd(), pdfPath)} does not exist. Run labshelf build first.`);
    return 2;
  }
  let findings: CheckProblem[];
  try {
    findings = await check({ folder: project.folder, pdfPath, settings: project.settings.check }, ctx.logger);
  } catch (error) {
    await ctx.logger.error("terminal.check", error, { folder: project.folder, pdf: pdfPath });
    io.err(`Check failed: ${formatError(error)}`);
    return 1;
  }
  if (flags["json"] === true) {
    io.out(JSON.stringify(findings, null, 2));
  } else if (findings.length === 0) {
    io.out("No problems found before submitting.");
  } else {
    findings.forEach((finding) => io.out(findingLine(finding, pdfPath, process.cwd())));
  }
  return findings.length === 0 ? 0 : 1;
}
