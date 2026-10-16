// Describes one figure row of the Writing view: the figure, its recipe and whether it is up to date.
import type { FigureRecipe, FigureState, ProjectEntry } from "@labshelf/core";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export interface FigureNode {
  kind: "figure";
  project: ReadyProject;
  /** The figure path as written in labshelf.yaml, relative to the project folder. */
  path: string;
  recipe: FigureRecipe;
  state: FigureState;
}
