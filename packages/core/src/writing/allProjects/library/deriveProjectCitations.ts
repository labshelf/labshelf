// Lists the keys a project cites and where each resolves: a library paper, a .bib entry or nowhere.
import { formatAuthors } from "../../../library/record.js";
import type { PaperRecord } from "../../../model/index.js";
import { parseBibEntries } from "../../bibliography/index.js";
import { derivePapersByCiteKey, scanCiteKeys } from "../../citations/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ProjectSettings } from "../../project/index.js";
import { readOptionalText, listBuildRootFileNames, type ProjectReadContext } from "../../project/folder/index.js";
import type { ProjectCitation } from "../projectDetailPane.js";
import type { ProjectSourceTexts } from "./readProjectSources.js";

/** Keys of the root .bib files and of the project's bibliography file. */
async function bibKeys(context: ProjectReadContext, folder: string, settings: ProjectSettings): Promise<Set<string>> {
  const { fs, paths } = context;
  const roots = (await listBuildRootFileNames(context, folder)).filter((name) => name.endsWith(".bib"));
  const files = new Set([...roots, settings.bibliography ?? DEFAULT_BIBLIOGRAPHY].map((file) => paths.join(folder, file)));
  const texts = await Promise.all([...files].map((file) => readOptionalText(fs, file)));
  return new Set(texts.flatMap((text) => (text === undefined ? [] : parseBibEntries(text).map((entry) => entry.key))));
}

function libraryCitation(paper: PaperRecord): ProjectCitation {
  const authors = formatAuthors(paper.authors);
  return {
    key: paper.citeKey, source: "library", paperId: paper.id, title: paper.title,
    ...(authors === "" ? {} : { authors }), ...(paper.year === undefined ? {} : { year: String(paper.year) }),
  };
}

/** One entry per distinct cited key, in key order. Rejects when a .bib file cannot be read. */
export async function deriveProjectCitations(
  context: ProjectReadContext, folder: string, settings: ProjectSettings, sources: ProjectSourceTexts, papers: readonly PaperRecord[],
): Promise<ProjectCitation[]> {
  const keys = [...new Set(sources.texts.flatMap(({ text }) => scanCiteKeys(settings.format, text)))].sort();
  const library = derivePapersByCiteKey(papers);
  const bib = keys.some((key) => !library.has(key)) ? await bibKeys(context, folder, settings) : new Set<string>();
  return keys.map((key) => {
    const paper = library.get(key);
    if (paper !== undefined) { return libraryCitation(paper); }
    return { key, source: bib.has(key) ? "bib" : "none" };
  });
}
