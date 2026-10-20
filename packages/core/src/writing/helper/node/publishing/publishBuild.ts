// Builds publication snapshots with the helper toolchains and reads the complete sample PDF.
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { buildProject, type ProjectBuildDeps } from "../../../build/node/index.js";
import { builtPdfPath } from "../../../build/index.js";
import type { PublishableProject } from "../../../templates/publishing/index.js";
import type { PublishBuildResult } from "../../../templates/index.js";

export async function buildPublication(project: PublishableProject, folder: string, deps: Omit<ProjectBuildDeps, "projects">, signal: AbortSignal): Promise<PublishBuildResult> {
  const settings = { id: project.id, format: project.format, ...(project.engine === "typst" ? {} : { engine: project.engine }) };
  const entry = { kind: "ready" as const, location: "external" as const, folder, settings, main: project.main };
  const result = await buildProject(entry, { ...deps, projects: { projectBuildDir: () => path.join(folder, "..", "build") } }, { mode: "full", force: true, signal });
  if (result.status !== "succeeded") {
    const problems = "problems" in result ? result.problems.filter((p) => p.severity === "error").map((p) => p.message) : [];
    return { ok: false, problems: problems.length ? problems : [`The template build ended with ${result.status}.`] };
  }
  const pdf = builtPdfPath(path, entry);
  if (!pdf) throw new Error(`No sample PDF for project "${project.id}"`);
  return { ok: true, pdf: new Uint8Array(await readFile(pdf)) };
}
