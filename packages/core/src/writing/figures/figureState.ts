/** Decides whether a figure is missing, stale or fresh from the modification times of the figure and its inputs. */

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

export function decideFigureState({ figureMtimeMs, inputs, missingInputs }: FigureFacts): FigureState {
  if (figureMtimeMs === undefined) { return { status: "missing", missingInputs }; }
  const newerInputs = inputs.filter((input) => input.mtimeMs > figureMtimeMs).map((input) => input.path);
  return newerInputs.length > 0 ? { status: "stale", newerInputs, missingInputs } : { status: "fresh", missingInputs };
}
