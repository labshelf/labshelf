/** Reads the staleness of a project's figures from the modification times of the figures and their inputs on disk. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { listProjectFiles } from "../../project/node/index.js";
import type { FigureRecipe } from "../../project/index.js";
import { decideFigureState, type FigureFacts, type FigureState } from "../figureState.js";
import { isGlobPattern, matchesInputPattern, normalizeInputPath } from "../inputPattern.js";

async function modifiedAt(file: string): Promise<number | undefined> {
  return fs.stat(file).then((stats) => stats.mtimeMs, (error: NodeJS.ErrnoException) => {
    // A path through a regular file (`a.py/b`) is as absent as a missing one.
    if (error.code === "ENOENT" || error.code === "ENOTDIR") { return undefined; }
    throw error;
  });
}

async function inputFacts(
  folder: string, inputs: readonly string[], projectFiles: () => Promise<readonly string[]>,
): Promise<Pick<FigureFacts, "inputs" | "missingInputs">> {
  const found = new Map<string, number>();
  const missingInputs: string[] = [];
  for (const input of inputs) {
    if (isGlobPattern(input)) {
      for (const relative of await projectFiles()) {
        if (!matchesInputPattern(input, relative) || found.has(relative)) { continue; }
        const mtimeMs = await modifiedAt(path.join(folder, relative));
        if (mtimeMs !== undefined) { found.set(relative, mtimeMs); }
      }
      continue;
    }
    const relative = normalizeInputPath(input);
    const mtimeMs = await modifiedAt(path.join(folder, relative));
    if (mtimeMs === undefined) { missingInputs.push(input); } else { found.set(relative, mtimeMs); }
  }
  return { inputs: [...found].map(([inputPath, mtimeMs]) => ({ path: inputPath, mtimeMs })), missingInputs };
}

/** The state of every figure, by figure path; the folder is walked at most once and only for glob inputs. */
export async function readFigureStates(
  folder: string, figures: Readonly<Record<string, FigureRecipe>>,
): Promise<Record<string, FigureState>> {
  let walked: Promise<readonly string[]> | undefined;
  const projectFiles = (): Promise<readonly string[]> => {
    walked ??= listProjectFiles(folder).then((files) => files.map((file) => path.relative(folder, file).split(path.sep).join("/")));
    return walked;
  };
  const states: Record<string, FigureState> = {};
  for (const [figure, recipe] of Object.entries(figures)) {
    const figureMtimeMs = await modifiedAt(path.join(folder, normalizeInputPath(figure)));
    states[figure] = decideFigureState({ figureMtimeMs, ...await inputFacts(folder, recipe.inputs, projectFiles) });
  }
  return states;
}
