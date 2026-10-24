// Finds the arXiv or OpenAlex twin of a paper that has only a title, learning its arXiv id and open-access copies.
import { arxivIdFromUrl } from "../../identifiers/index.js";
import { openAlexAutocomplete, parseArxivFeed } from "../../registries/index.js";
import type { RegistryEnv, RegistryRecord } from "../../registries/index.js";
import { sameWork, surname } from "../../paper/index.js";
import { lookupText } from "./timedFetch.js";
import type { PdfResolver, ResolveContext, ResolverEnv } from "../pdfResolver.js";
import { acceptRecord } from "./matchPaper.js";
import { learnIds } from "./learnIds.js";
import { openAlexCopies } from "./openalex.js";

// TRAP: `acceptRecord` accepts anything when the context has no title, so a title is required before searching by it.
// The arXiv hit is gated without a year: a preprint is often posted years before its published version.

export const titleTwinResolver: PdfResolver = {
  name: "title-twin",
  async resolve(ctx, env) {
    if (!ctx.title || ctx.doi || ctx.arxivId) return [];
    if (await learnFromArxiv(ctx, env, ctx.title)) return [];
    return copiesFromOpenAlex(ctx, env, ctx.title);
  },
};

async function learnFromArxiv(ctx: ResolveContext, env: ResolverEnv, title: string): Promise<boolean> {
  const family = ctx.authors?.[0] ? surname(ctx.authors[0]) : "";
  const phrase = encodeURIComponent(`ti:"${title.replace(/"/g, " ")}"`);
  const author = family ? `+AND+au:${encodeURIComponent(family)}` : "";
  const xml = await lookupText(env, `https://export.arxiv.org/api/query?search_query=${phrase}${author}&max_results=3`);
  if (!xml) return false;
  for (const entry of parseArxivFeed(xml)) {
    const arxivId = arxivIdFromUrl(entry.url ?? "");
    if (!arxivId || !acceptRecord("title-twin-arxiv", ctx, env, workOf(entry))) continue;
    learnIds(ctx, { arxivId });
    return true;
  }
  return false;
}

function workOf(entry: RegistryRecord): { title: string | undefined; authors?: string[] } {
  return { title: entry.title, ...(entry.authors?.length ? { authors: entry.authors } : {}) };
}

async function copiesFromOpenAlex(ctx: ResolveContext, env: ResolverEnv, title: string): Promise<string[]> {
  const registryEnv: RegistryEnv = { fetch: env.fetch, logger: env.logger, contactEmail: ctx.contactEmail };
  const suggestions = await openAlexAutocomplete(registryEnv, title);
  const expected = { title, ...(ctx.authors?.length ? { authors: ctx.authors } : {}) };
  const hit = suggestions.find((s) => sameWork({ title: s.title, ...(s.authors.length ? { authors: s.authors } : {}) }, expected));
  return hit ? openAlexCopies(ctx, env, hit.workId) : [];
}
