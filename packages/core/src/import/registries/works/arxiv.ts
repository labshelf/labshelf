/** Looks up arXiv preprints by identifier and reads arXiv Atom answers. */
import { extractYear } from "../../metadata/index.js";
import { fetchText, type RegistryEnv } from "../http.js";
import { matchTag, xmlText } from "../text.js";
import type { RegistryRecord } from "../types.js";

/**
 * Looks up an arXiv preprint by its identifier.
 * @returns Preprint metadata, or undefined when the id is unknown.
 */
export async function arxivById(env: RegistryEnv, arxivId: string): Promise<RegistryRecord | undefined> {
  const xml = await fetchText(
    env,
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
  );
  return xml ? parseArxivFeed(xml)[0] : undefined;
}

/**
 * Reads the preprints of an arXiv Atom answer.
 * @returns One record per entry, `url` being the abstract page; none for an error entry.
 */
export function parseArxivFeed(xml: string): RegistryRecord[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match) => match[1] ?? "")
    .filter((entry) => !/<title>\s*Error/i.test(entry))
    .map(mapArxivEntry);
}

function mapArxivEntry(entry: string): RegistryRecord {
  // A preprint has no DOI until it is published; `<id>` is its abstract page.
  return {
    title: xmlText(matchTag(entry, "title")),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
      .map((match) => xmlText(match[1] ?? ""))
      .filter((name): name is string => Boolean(name)),
    year: extractYear(matchTag(entry, "published") ?? matchTag(entry, "updated")),
    journal: xmlText(matchTag(entry, "arxiv:journal_ref")) ?? "arXiv preprint",
    doi: xmlText(matchTag(entry, "arxiv:doi")),
    url: xmlText(matchTag(entry, "id")),
    summary: xmlText(matchTag(entry, "summary")),
  };
}
