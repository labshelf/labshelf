/** Resolves the files a build log names to source files of the project, so every problem can be shown in an editor. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LocatedProblem } from "../buildResult.js";
import type { BuildProblem } from "../../log/index.js";

export interface ProblemPlaces {
  projectFolder: string;
  /** The folder the build ran in; log paths are relative to it. */
  workDir: string;
  mainFile: string;
}

function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function isFile(file: string): Promise<boolean> {
  return fs.stat(file).then((stat) => stat.isFile(), () => false);
}

// TRAP: Tectonic names \input files without their extension ("chapters/intro").
async function projectFile(logPath: string, places: ProblemPlaces): Promise<string | undefined> {
  const absolute = path.resolve(places.workDir, logPath);
  for (const candidate of [absolute, `${absolute}.tex`]) {
    if (isInside(places.projectFolder, candidate) && await isFile(candidate)) { return candidate; }
  }
  return undefined;
}

/** A problem in a file outside the project (a package, a class) goes on the main file, named after that file. */
export async function locateProblems(problems: readonly BuildProblem[], places: ProblemPlaces): Promise<LocatedProblem[]> {
  return Promise.all(problems.map(async ({ file, line, ...rest }): Promise<LocatedProblem> => {
    const located = file ? await projectFile(file, places) : undefined;
    if (located) { return line === undefined ? { ...rest, file: located } : { ...rest, file: located, line }; }
    const message = file ? `${path.basename(file)}: ${rest.message}` : rest.message;
    return { ...rest, message, file: places.mainFile };
  }));
}
