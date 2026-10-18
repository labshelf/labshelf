// Compiles the page's Typst project for LabShelf's web build, which names files relative to the project folder.
import type { ILogger } from "@labshelf/core";
import type { TypstHostOutcome, TypstHostRequest } from "@labshelf/core/helper";
import { typstProblems, type TypstSession } from "@labshelf/core/typst";
import { compilerPath, COMPILER_ROOT } from "./projectSnapshot";

const MODULE = "browser.editor.typst";

export interface TypstHostCompilerDeps {
  /** The page's one project; the session reads its files. */
  projectId: string;
  /** Opens the compiler over the project's files; called on the first compile only. */
  open(): Promise<Pick<TypstSession, "compile">>;
  logger: ILogger;
}

const relativeOf = (path: string): string => (path.startsWith(`${COMPILER_ROOT}/`) ? path.slice(COMPILER_ROOT.length + 1) : path);

export function createTypstHostCompiler({ projectId, open, logger }: TypstHostCompilerDeps): (request: TypstHostRequest) => Promise<TypstHostOutcome> {
  let session: Promise<Pick<TypstSession, "compile">> | undefined;
  return async (request) => {
    if (request.projectId !== projectId) throw new Error(`This page compiles ${projectId}, not ${request.projectId}`);
    // A session that failed to open is opened again on the next compile, so a font download that failed once can recover.
    session ??= open().catch((error: unknown) => { session = undefined; throw error; });
    const started = performance.now();
    const result = await (await session).compile({
      root: COMPILER_ROOT,
      main: compilerPath(request.main),
      sources: new Map(request.sources.map(({ path, text }) => [compilerPath(path), text])),
    });
    const problems = typstProblems(result.diagnostics, request.main, relativeOf);
    await logger.log("INFO", MODULE, "Compiled Typst for LabShelf", { project: projectId, main: request.main, ms: Math.round(performance.now() - started), pdf: !!result.pdf });
    if (!result.pdf) {
      if (!problems.some((problem) => problem.severity === "error")) {
        problems.unshift({ severity: "error", message: "Typst produced no PDF and reported no error.", file: request.main });
      }
      return { status: "failed", problems };
    }
    return { status: "succeeded", pdf: result.pdf, problems, cites: result.citations && "cites" in result.citations ? result.citations.cites : [] };
  };
}
