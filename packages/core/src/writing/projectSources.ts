// Reads the source files of a build root: a LaTeX root with the files it includes, a Typst root alone.
import { readLatexProjectSources, type ProjectSourceReader } from "../latex/index.js";
import type { ProjectSettings } from "./project/index.js";

export interface SourcesProject {
  folder: string;
  settings: Pick<ProjectSettings, "format">;
}

/** `root` is the project-relative path of the root file; a file that cannot be read is left out. */
export function createProjectSources(
  readerFor: (folder: string) => ProjectSourceReader,
): (project: SourcesProject, root: string) => Promise<{ file: string; text: string }[]> {
  return async (project, root) => {
    const reader = readerFor(project.folder);
    // Typst includes are not followed, so its root counts as its own file.
    const files = project.settings.format === "typst"
      ? [root]
      : (await readLatexProjectSources(root, reader)).files.map((file) => file.path);
    const sources: { file: string; text: string }[] = [];
    for (const file of files) {
      const text = await reader.read(file);
      if (text !== undefined) { sources.push({ file, text }); }
    }
    return sources;
  };
}
