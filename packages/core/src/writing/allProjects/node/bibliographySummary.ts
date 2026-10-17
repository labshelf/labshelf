// Summarises the project's bibliography file: its entries, whether LabShelf generated it and when it was written.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readOptionalFile } from "../../../library/node/index.js";
import { bibEntries } from "../../bibLint/index.js";
import { BIBLIOGRAPHY_HEADER } from "../../citations/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ProjectSettings } from "../../project/index.js";
import type { ProjectDetail } from "../projectDetail.js";

/** Undefined when the project has no bibliography file yet. */
export async function bibliographySummary(folder: string, settings: ProjectSettings): Promise<ProjectDetail["bibliography"]> {
  const file = settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  const absolute = path.join(folder, file);
  const text = await readOptionalFile(absolute);
  if (text === undefined) { return undefined; }
  const { mtimeMs } = await fs.stat(absolute);
  return {
    file, entries: bibEntries(text).length, generated: text.split(/\r?\n/, 1)[0] === BIBLIOGRAPHY_HEADER, written: Math.round(mtimeMs),
  };
}
