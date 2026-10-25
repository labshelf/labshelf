// Runs `labshelf build`: builds a writing project through the core queue, prints its problems and optionally rebuilds on changes.
import * as path from "node:path";

import type { ProjectBuildResult, LocatedProblem, ToolchainMissing } from "@labshelf/core";

import type { Output } from "../usage.js";
import { createTtyAsk, createTerminalBuildEnvironment, type BuildContext, type BuildEnvironment } from "./buildEnvironment.js";
import { findProject, type ReadyProject } from "./findProject.js";

/** `path:line: severity: message`, then the hint indented on the next line; paths are relative to `cwd` so editors can jump to them. */
function problemLines(problems: readonly LocatedProblem[], projectFolder: string, cwd: string): string[] {
  return problems.flatMap((problem) => {
    const file = path.relative(cwd, path.resolve(projectFolder, problem.file));
    const where = problem.line === undefined ? file : `${file}:${problem.line}`;
    const line = `${where}: ${problem.severity}: ${problem.message}`;
    return problem.hint ? [line, `  ${problem.hint}`] : [line];
  });
}

function toolchainMissingText(missing: ToolchainMissing): string {
  switch (missing.reason) {
    case "declined":
      return "No LaTeX found. Install TeX Live or run labshelf build in a terminal to install TinyTeX.\nIn CI, install TeX Live and set `engine:` in labshelf.yaml.";
    case "install-failed": return `Installing LaTeX failed: ${missing.message}`;
  }
}

/** Prints one build's outcome and returns its exit code: 0 built, 1 problems, 2 toolchain missing. */
function report(result: ProjectBuildResult, project: ReadyProject, io: Output): number {
  switch (result.status) {
    case "succeeded":
      problemLines(result.problems, project.folder, process.cwd()).forEach(io.out);
      io.out(`Built ${path.relative(process.cwd(), result.pdf)}`);
      return 0;
    case "failed":
      problemLines(result.problems, project.folder, process.cwd()).forEach(io.out);
      io.out("Build failed.");
      return 1;
    case "toolchain-missing":
      io.err(toolchainMissingText(result));
      return 2;
    case "no-main":
      io.err(`${project.folder} has no main file. Set main: in labshelf.yaml.`);
      return 1;
    case "cancelled":
      return 1;
  }
}

async function buildOnce(env: BuildEnvironment, project: ReadyProject, ctx: BuildContext, io: Output): Promise<number> {
  try {
    return report(await env.queue.request(project), project, io);
  } catch (error) {
    await ctx.logger.error("terminal.build", error, { folder: project.folder });
    io.err(`Build failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function watchAndRebuild(env: BuildEnvironment, project: ReadyProject, ctx: BuildContext, io: Output): Promise<number> {
  io.out("Watching for changes. Press Ctrl-C to stop.");
  const stop = env.watchSources(project.folder, () => {
    void env.queue.request(project).then(
      (result) => { if (result.status !== "cancelled") { report(result, project, io); } },
      (error: unknown) => { io.err(`Build failed: ${error instanceof Error ? error.message : String(error)}`); },
    );
  });
  await env.interrupted();
  stop();
  env.queue.cancelAll();
  return 0;
}

/**
 * @param positionals the project folder or id; absent means the project containing the working directory
 * @param flags `watch` keeps rebuilding on source changes until Ctrl-C
 * @returns the exit code: 0 built, 1 build problems or errors, 2 toolchain missing
 */
export async function runBuild(
  ctx: BuildContext, positionals: string[], flags: Record<string, string | boolean>, io: Output,
  env: BuildEnvironment = createTerminalBuildEnvironment(ctx, { ask: createTtyAsk() }),
): Promise<number> {
  const project = await findProject(ctx.paths.root, ctx.logger, positionals[0], process.cwd());
  const code = await buildOnce(env, project, ctx, io);
  if (flags["watch"] !== true || code === 2) { return code; }
  return watchAndRebuild(env, project, ctx, io);
}
