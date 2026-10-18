// Shows a build's problems for one file as editor diagnostics on the problem's line.
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { HelperProblem } from "../helperProject";

/** Listens to one file's problems; returns the function that stops listening. */
export type ProblemSource = (path: string, listener: (problems: readonly HelperProblem[]) => void) => () => void;

export function toDiagnostics(problems: readonly HelperProblem[], view: Pick<EditorView, "state">): Diagnostic[] {
  const doc = view.state.doc;
  return problems.map((problem) => {
    const line = doc.line(Math.min(Math.max(problem.line ?? 1, 1), doc.lines));
    return {
      from: line.from, to: line.to, severity: problem.severity,
      message: problem.hint === undefined ? problem.message : `${problem.message}\n${problem.hint}`,
    };
  });
}

export function applyProblems(view: EditorView, problems: readonly HelperProblem[]): void {
  view.dispatch(setDiagnostics(view.state, toDiagnostics(problems, view)));
}
