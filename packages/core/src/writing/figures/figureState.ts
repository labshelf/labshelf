/** Decides whether a figure is missing, stale or fresh from the modification times of the figure and its inputs, and reads those times for a project. */
import { listProjectFiles, type ProjectReadContext, type FigureRecipe } from "../project/index.js";

/** Describes how a figure's shell command ended: finished with an exit code and output, or cancelled. */
export type FigureRunResult =
  | { status: "finished"; /** Null when a signal ended the command. */ code: number | null; /** The tail of stdout and stderr. */ output: string }
  | { status: "cancelled" };

export interface FigureFacts {
  /** The figure file's modification time, or undefined when the file does not exist. */
  figureMtimeMs: number | undefined;
  /** The inputs that exist, with their modification times. */
  inputs: ReadonlyArray<{ path: string; mtimeMs: number }>;
  /** Literal inputs that do not exist. They do not make a figure stale; the user still sees them. */
  missingInputs: readonly string[];
}

export type FigureState =
  | { status: "missing"; missingInputs: readonly string[] }
  | { status: "stale"; newerInputs: readonly string[]; missingInputs: readonly string[] }
  | { status: "fresh"; missingInputs: readonly string[] };

export function deriveFigureBuildState({ figureMtimeMs, inputs, missingInputs }: FigureFacts): FigureState {
  if (figureMtimeMs === undefined) { return { status: "missing", missingInputs }; }
  const newerInputs = inputs.filter((input) => input.mtimeMs > figureMtimeMs).map((input) => input.path);
  return newerInputs.length > 0 ? { status: "stale", newerInputs, missingInputs } : { status: "fresh", missingInputs };
}

// CONTRACT: documents/contracts/library-format.md#labshelfyaml
// Figure input patterns match project-relative POSIX paths with `*`, `**` and `?`.
const GLOB_CHARACTERS = /[*?]/;

/** True when the pattern names more than one possible path; a literal input names exactly one file. */
export function isGlobPattern(pattern: string): boolean {
  return GLOB_CHARACTERS.test(pattern);
}

/** A leading `./` is the same folder, so `./a.py` and `a.py` name one file. */
export function normalizeInputPath(pattern: string): string {
  return pattern.replace(/^(\.\/)+/, "");
}

function matchesSegment(pattern: string, segment: string): boolean {
  let p = 0;
  let s = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (s < segment.length) {
    if (pattern[p] === "*") {
      starAt = p++;
      resumeAt = s;
    } else if (pattern[p] === "?" || pattern[p] === segment[s]) {
      p++;
      s++;
    } else if (starAt >= 0) {
      p = starAt + 1;
      s = ++resumeAt;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") { p++; }
  return p === pattern.length;
}

function matchesSegments(pattern: readonly string[], path: readonly string[]): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined) { return path.length === 0; }
  if (head === "**") {
    return path.some((_, skipped) => matchesSegments(rest, path.slice(skipped))) || matchesSegments(rest, []);
  }
  const [segment, ...remaining] = path;
  return segment !== undefined && matchesSegment(head, segment) && matchesSegments(rest, remaining);
}

/** Whether a path relative to the project folder matches an input pattern; `*` and `?` stay within one segment and `**` spans any number of segments, including none. */
export function isInputPatternMatch(pattern: string, relativePath: string): boolean {
  return matchesSegments(normalizeInputPath(pattern).split("/"), normalizeInputPath(relativePath).split("/"));
}

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
        if (!isInputPatternMatch(input, relative) || found.has(relative)) { continue; }
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
export async function readFigureBuildStates(
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
    states[figure] = deriveFigureBuildState({ figureMtimeMs, ...await inputFacts(reads, folder, recipe.inputs, projectFiles) });
  }
  return states;
}
