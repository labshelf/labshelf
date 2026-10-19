// Holds the latest build's problems per project file and tells each subscribed file when they change.
import type { HelperCompileResult } from "@labshelf/core/helper";

export type HelperProblem = HelperCompileResult["problems"][number];
type ProblemListener = (problems: readonly HelperProblem[]) => void;

export interface ProblemStore {
  /** Calls `listener` at once with the file's current problems; returns the function that stops listening. */
  subscribe(path: string, listener: ProblemListener): () => void;
  /** Replaces every file's problems with those of `problems`; files without any get an empty list. */
  publish(problems: readonly HelperProblem[]): void;
}

export function createProblemStore(): ProblemStore {
  let byFile = new Map<string, HelperProblem[]>();
  const listeners = new Map<string, Set<ProblemListener>>();
  return {
    subscribe(path, listener) {
      const set = listeners.get(path) ?? new Set<ProblemListener>();
      set.add(listener);
      listeners.set(path, set);
      listener(byFile.get(path) ?? []);
      return () => { set.delete(listener); };
    },
    publish(problems) {
      byFile = new Map();
      for (const problem of problems) {
        const list = byFile.get(problem.file) ?? [];
        list.push(problem);
        byFile.set(problem.file, list);
      }
      for (const [path, set] of listeners) {
        for (const listener of [...set]) listener(byFile.get(path) ?? []);
      }
    },
  };
}
