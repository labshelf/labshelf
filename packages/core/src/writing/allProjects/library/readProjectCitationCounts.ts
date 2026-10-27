// Counts the distinct keys a project cites and those found in neither the library nor a .bib file.
import type { PaperRecord } from "../../../model/index.js";
import type { ProjectSettings } from "../../project/index.js";
import type { ProjectReadContext } from "../../project/projectReads.js";
import { deriveProjectCitations } from "./deriveProjectCitations.js";
import { readProjectSources } from "./readProjectSources.js";

export async function readProjectCitations(
  context: ProjectReadContext, folder: string, settings: ProjectSettings, papers: readonly PaperRecord[],
): Promise<{ cites: number; unresolved: number }> {
  const citations = await deriveProjectCitations(context, folder, settings, await readProjectSources(context, folder, settings), papers);
  return { cites: citations.length, unresolved: citations.filter((citation) => citation.source === "none").length };
}
