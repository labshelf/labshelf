// Reads the source texts of a project from its main file, in the order they read.
import { readLatexProjectSources } from "../../../latex/sourceProject.js";
import { deriveReadingOrderTexts } from "../../checks/index.js";
import type { ProjectSettings } from "../../project/index.js";
import { readOptionalText, type ProjectReadContext } from "../../project/folder/index.js";

export interface ProjectSourceTexts {
  /** Project-relative paths, main first. */
  paths: string[];
  /** The texts in reading order, each include placed where it is written. */
  texts: { text: string }[];
}

/** A LaTeX project reads its include tree; a Typst project reads its main file alone. A missing main file gives no sources. */
export async function readProjectSources(
  { fs, paths }: ProjectReadContext, folder: string, settings: ProjectSettings,
): Promise<ProjectSourceTexts> {
  const main = settings.main;
  if (main === undefined) { return { paths: [], texts: [] }; }
  const read = (relativePath: string): Promise<string | undefined> => readOptionalText(fs, paths.join(folder, relativePath));
  if (settings.format === "typst") {
    const text = await read(main);
    return text === undefined ? { paths: [], texts: [] } : { paths: [main], texts: [{ text }] };
  }
  const texts = new Map<string, string>();
  const { files } = await readLatexProjectSources(main, {
    read: async (relativePath) => {
      const text = await read(relativePath);
      if (text !== undefined) { texts.set(relativePath, text); }
      return text;
    },
  });
  return { paths: files.map((file) => file.path), texts: deriveReadingOrderTexts(files, texts) };
}
