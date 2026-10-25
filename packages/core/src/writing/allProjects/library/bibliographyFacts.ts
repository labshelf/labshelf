// Summarises the project's bibliography file: its entries, whether LabShelf generated it and when it was written.
import { bibEntries } from "../../bibliography/index.js";
import { BIBLIOGRAPHY_HEADER } from "../../citations/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ProjectSettings } from "../../project/index.js";
import { readOptionalText, type ProjectReadContext } from "../../project/folder/index.js";
import type { ProjectDetail } from "../projectDetailPane.js";

/** Undefined when the project has no bibliography file yet. */
export async function bibliographySummary(
  { fs, paths }: ProjectReadContext, folder: string, settings: ProjectSettings,
): Promise<ProjectDetail["bibliography"]> {
  const file = settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  const absolute = paths.join(folder, file);
  const text = await readOptionalText(fs, absolute);
  if (text === undefined) { return undefined; }
  const mtimeMs = (await fs.stat(absolute))?.mtimeMs ?? 0;
  return {
    file, entries: bibEntries(text).length, generated: text.split(/\r?\n/, 1)[0] === BIBLIOGRAPHY_HEADER, written: Math.round(mtimeMs),
  };
}
