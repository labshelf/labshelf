// Routes the writing-project commands (install, build, cite, projects, check) to their runners.
import type { AppContext } from "../../compositionRoot.js";
import type { ParsedArgs } from "../args.js";
import { runBuild } from "../build/index.js";
import { runCheck } from "../check/index.js";
import { runCite } from "../citation/index.js";
import { runProjects } from "../projects/index.js";
import { UsageError, type Output } from "../usage.js";
import { runInstall } from "./installCommand.js";

/**
 * @returns the exit code
 * @throws UsageError when the command word is not a project command
 */
export function runProjectCommand(ctx: AppContext, args: ParsedArgs, io: Output): Promise<number> {
  const { command, positionals, flags } = args;
  switch (command) {
    case "install": return runInstall(ctx, positionals, io, flags);
    case "build": return runBuild(ctx, positionals, flags, io);
    case "cite": return runCite(ctx, positionals, flags, io);
    case "projects": return runProjects(ctx, positionals, flags, io);
    case "check": return runCheck(ctx, positionals, flags, io);
    default: throw new UsageError(`Unknown command "${command}". Run labshelf --help.`);
  }
}
