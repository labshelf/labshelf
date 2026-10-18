/** Reads the staleness of a project's figures from the modification times of the figures and their inputs. */
import { listProjectFiles, type ProjectReadContext } from "../project/folder/index.js";
import type { FigureRecipe } from "../project/index.js";
import { decideFigureState, type FigureFacts, type FigureState } from "./figureState.js";
import { isGlobPattern, matchesInputPattern, normalizeInputPath } from "./inputPattern.js";

type FileReads = Pick<ProjectReadContext, "fs" | "paths">;

/** The port reports a path through a regular file (`a.py/b`) as absent, like a missing one. */
async function modifiedAt({ fs }: FileReads, file: string): Promise<number | undefined> {
  return (await fs.stat(file))?.mtimeMs;
}

async function inputFacts(
  reads: FileReads, folder: string, inputs: readonly string[], projectFiles: () => Promise<readonly string[]>,
): Promise<Pick<FigureFacts, "inputs" | "missingInputs">> {
  const found = new Map<string, number>();
  const missingInputs: string[] = [];
  for (const input of inputs) {
    if (isGlobPattern(input)) {
      for (const relative of await projectFiles()) {
        if (!matchesInputPattern(input, relative) || found.has(relative)) { continue; }
        const mtimeMs = await modifiedAt(reads, reads.paths.join(folder, relative));
        if (mtimeMs !== undefined) { found.set(relative, mtimeMs); }
      }
      continue;
    }
    const relative = normalizeInputPath(input);
    const mtimeMs = await modifiedAt(reads, reads.paths.join(folder, relative));
    if (mtimeMs === undefined) { missingInputs.push(input); } else { found.set(relative, mtimeMs); }
  }
  return { inputs: [...found].map(([inputPath, mtimeMs]) => ({ path: inputPath, mtimeMs })), missingInputs };
}

/** The state of every figure, by figure path; the folder is walked at most once and only for glob inputs. */
export async function readFigureStates(
  reads: FileReads, folder: string, figures: Readonly<Record<string, FigureRecipe>>,
): Promise<Record<string, FigureState>> {
  let walked: Promise<readonly string[]> | undefined;
  const projectFiles = (): Promise<readonly string[]> => {
    walked ??= listProjectFiles(reads, folder);
    return walked;
  };
  const states: Record<string, FigureState> = {};
  for (const [figure, recipe] of Object.entries(figures)) {
    const figureMtimeMs = await modifiedAt(reads, reads.paths.join(folder, normalizeInputPath(figure)));
    states[figure] = decideFigureState({ figureMtimeMs, ...await inputFacts(reads, folder, recipe.inputs, projectFiles) });
  }
  return states;
}
