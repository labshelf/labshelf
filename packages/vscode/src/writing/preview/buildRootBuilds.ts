// Records the last build of every root a project has built, keyed by the root's absolute path so one root never overwrites another.
import type { BuildState, LocatedProblem, PathOps, TypstCitation } from "@labshelf/core";
import type { FinishedBuild } from "../build/index.js";

export interface BuildRootBuildState {
  state: BuildState;
  errors: number;
}

export class BuildRootBuilds {
  private readonly problems = new Map<string, readonly LocatedProblem[]>();
  // INVARIANT: the cites of a root's last successful Typst build, i.e. of the PDF a preview shows; a failed build leaves them.
  private readonly cites = new Map<string, readonly TypstCitation[]>();
  // A preview opened during a build or after a failed one shows that state at once.
  private readonly states = new Map<string, BuildRootBuildState>();
  // The roots each project has built, in build order; the reader lists exactly these.
  private readonly built = new Map<string, Set<string>>();

  constructor(private readonly paths: PathOps) {}

  started(projectFolder: string, root: string): void {
    this.states.set(this.paths.join(projectFolder, root), { state: "building", errors: 0 });
  }

  /** Records a finished build and returns the number of errors it reported. */
  finished(projectFolder: string, root: string, result: FinishedBuild): number {
    const key = this.paths.join(projectFolder, root);
    this.problems.set(key, result.problems);
    this.built.set(projectFolder, (this.built.get(projectFolder) ?? new Set<string>()).add(root));
    const errors = result.problems.filter((problem) => problem.severity === "error").length;
    if (result.status === "failed") {
      this.states.set(key, { state: "failed", errors });
      return errors;
    }
    this.states.delete(key);
    if ("cites" in result) { this.cites.set(key, result.cites); }
    return errors;
  }

  /** The running or failed build of a root; undefined once its last build succeeded. */
  stateOf(projectFolder: string, root: string): BuildRootBuildState | undefined {
    return this.states.get(this.paths.join(projectFolder, root));
  }

  /** The problems of a root's last build, or undefined when the project has not built that root. */
  problemsOf(projectFolder: string, root: string): readonly LocatedProblem[] | undefined {
    return this.built.get(projectFolder)?.has(root) ? this.problems.get(this.paths.join(projectFolder, root)) : undefined;
  }

  citesOf(projectFolder: string, root: string): readonly TypstCitation[] | undefined {
    return this.cites.get(this.paths.join(projectFolder, root));
  }

  builtRoots(projectFolder: string): Iterable<string> {
    return this.built.get(projectFolder) ?? [];
  }
}
