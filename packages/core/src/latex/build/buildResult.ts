/** Describes the outcome of a LaTeX build: cancelled, succeeded with its PDF, or failed, with problems located in project files. */
import type { BuildProblem } from "../log/index.js";

export type LocatedProblem = Omit<BuildProblem, "file"> & { file: string };

export type LatexBuildResult =
  | { status: "cancelled" }
  | { status: "succeeded"; pdf: string; problems: LocatedProblem[] }
  | { status: "failed"; problems: LocatedProblem[] };
