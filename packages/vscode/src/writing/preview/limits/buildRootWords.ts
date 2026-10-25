// Counts the words of a preview root across its includes, up to where the project's limits stop counting.
import { readLatexProjectSources, deriveReadingOrderTexts, countWordsUpTo, type ProjectSourceReader } from "@labshelf/core";

import type { ReadyProject } from "../../buildRootDocument.js";

interface RootWordsDeps {
  /** Reads the files of a project folder, open editors first. */
  readerFor(folder: string): ProjectSourceReader;
}

/** `root` is the project-relative path of the root file. A Typst root counts as its own file, since its includes are not followed. */
export async function rootWords(deps: RootWordsDeps, project: ReadyProject, root: string): Promise<number> {
  const countUpTo = project.settings.check?.countUpTo ?? "references";
  const reader = deps.readerFor(project.folder);
  if (project.settings.format === "typst") {
    const text = await reader.read(root);
    return text === undefined ? 0 : countWordsUpTo([{ text }], countUpTo);
  }
  const texts = new Map<string, string>();
  const tree = await readLatexProjectSources(root, {
    read: async (path) => {
      const text = await reader.read(path);
      if (text !== undefined) { texts.set(path, text); }
      return text;
    },
  });
  return countWordsUpTo(deriveReadingOrderTexts(tree.files, texts), countUpTo);
}
