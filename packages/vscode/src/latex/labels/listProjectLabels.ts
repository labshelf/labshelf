// Lists the labels defined across a LaTeX project, each with where it is and the source line it sits on.
import type { LatexRange } from "@labshelf/core";
import type { LatexProject } from "../project/index.js";

export interface ProjectLabel {
  name: string;
  /** The project-root-relative path of the file defining it. */
  path: string;
  range: LatexRange;
  /** The trimmed source line holding the label. */
  line: string;
}

export function listProjectLabels(project: LatexProject): ProjectLabel[] {
  return project.files.flatMap((file) => {
    const lines = project.texts.get(file.path)?.split("\n") ?? [];
    return file.facts.labels.map((label) => ({
      name: label.name, path: file.path, range: label.range, line: lines[label.range.start.line]?.trim() ?? "",
    }));
  });
}

