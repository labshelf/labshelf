// Reads the source files of a build root: a LaTeX root with its includes, a Typst root alone.
import { collectProjectSources, type ProjectSourceReader } from "@labshelf/core";
import type { ReadyProject } from "../../mainDocument.js";

/** `root` is the project-relative path of the root file; a file that cannot be read is left out. */
export function projectSources(
  readerFor: (folder: string) => ProjectSourceReader,
): (project: ReadyProject, root: string) => Promise<{ file: string; text: string }[]> {
  return async (project, root) => {
    const reader = readerFor(project.folder);
    // Typst includes are not followed, so its root counts as its own file.
    const files = project.settings.format === "typst"
      ? [root]
      : (await collectProjectSources(root, reader)).files.map((file) => file.path);
    const sources: { file: string; text: string }[] = [];
    for (const file of files) {
      const text = await reader.read(file);
      if (text !== undefined) { sources.push({ file, text }); }
    }
    return sources;
  };
}
