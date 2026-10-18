// Lists the library's writing projects as text lines or, with --json, as a JSON array.
import type { ProjectEntry } from "@labshelf/core";
import { listProjects } from "@labshelf/core/node";

import type { AppContext } from "../../app/index.js";
import type { ParsedArgs } from "../args.js";
import type { Output } from "../usage.js";

/** What `--json` prints for one project: ready projects carry their settings, broken ones the reason. */
function describeProject(entry: ProjectEntry) {
  if (entry.kind === "broken") {
    return { kind: entry.kind, folder: entry.folder, location: entry.location, reason: entry.reason };
  }
  const { settings } = entry;
  return {
    kind: entry.kind, id: settings.id, name: settings.title ?? settings.id, format: settings.format, main: entry.main ?? null,
    folder: entry.folder, location: entry.location,
  };
}

function projectLine(project: ReturnType<typeof describeProject>): string {
  if (project.kind === "broken") { return `${project.folder}  broken: ${project.reason}`; }
  return `${project.name}  ${project.format}  ${project.main ?? "no main file"}`;
}

/** @returns the exit code: 1 when the library's projects cannot be listed */
export async function runProjects(
  ctx: Pick<AppContext, "paths" | "logger">, _positionals: string[], flags: ParsedArgs["flags"], io: Output,
): Promise<number> {
  let projects: ReturnType<typeof describeProject>[];
  try {
    projects = (await listProjects(ctx.paths.root, ctx.logger)).map(describeProject);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.err(`Could not list projects in ${ctx.paths.root}: ${reason}`);
    await ctx.logger.error("terminal.projects", error, { libraryRoot: ctx.paths.root });
    return 1;
  }
  if (flags["json"] === true) {
    io.out(JSON.stringify(projects, null, 2));
  } else if (projects.length === 0) {
    io.out("No projects");
  } else {
    for (const project of projects) { io.out(projectLine(project)); }
  }
  return 0;
}
