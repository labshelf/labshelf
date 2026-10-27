/** Matches records to the paper being searched, finds its title twin and tells which version a candidate URL holds. */
import { extractArxivIdentifierFromUrl } from "../identifiers/index.js";
import type { PdfVersion } from "../../model/index.js";
import { isSameWork, deriveSurname } from "../paper/index.js";
import type { WorkReference } from "../paper/index.js";
import { openAlexAutocomplete, parseArxivFeed } from "../registries/index.js";
import type { RegistryEnv, RegistryEntry } from "../registries/index.js";
import { reportWarning, type PdfResolver, type ResolveContext, type ResolverEnv } from "./finder.js";
import { addIdentifiers } from "./indexes.js";
import { openAlexCopies } from "./openAccess.js";
import { fetchResolverText } from "./hostPacer.js";

// --- matchPaper: Decides whether an aggregator record is for the paper being searched.
// TRAP: aggregators often attach a neighbouring paper's locations to a correct DOI, so a record must pass `sameWork` against the title.
// Without a title there is nothing to check and the record is accepted.

export function matchWork(source: string, ctx: ResolveContext, env: ResolverEnv, record: WorkReference): boolean {
  if (!ctx.title) return true;
  const expected: WorkReference = {
    title: ctx.title,
    year: ctx.year,
    ...(ctx.authors ? { authors: ctx.authors } : {}),
  };
  if (isSameWork(record, expected)) return true;
  reportWarning(env, "record is not the searched paper, ignoring it", { source, found: record.title ?? null, expected: ctx.title });
  return false;
}

// --- titleTwin: Finds the arXiv or OpenAlex twin of a paper that has only a title, learning its arXiv id and open-access copies.
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
  const family = ctx.authors?.[0] ? deriveSurname(ctx.authors[0]) : "";
  const phrase = encodeURIComponent(`ti:"${title.replace(/"/g, " ")}"`);
  const author = family ? `+AND+au:${encodeURIComponent(family)}` : "";
  const xml = await fetchResolverText(env, `https://export.arxiv.org/api/query?search_query=${phrase}${author}&max_results=3`);
  if (!xml) return false;
  for (const entry of parseArxivFeed(xml)) {
    const arxivId = extractArxivIdentifierFromUrl(entry.url ?? "");
    if (!arxivId || !matchWork("title-twin-arxiv", ctx, env, workOf(entry))) continue;
    addIdentifiers(ctx, { arxivId });
    return true;
  }
  return false;
}

function workOf(entry: RegistryEntry): { title: string | undefined; authors?: string[] } {
  return { title: entry.title, ...(entry.authors?.length ? { authors: entry.authors } : {}) };
}

async function copiesFromOpenAlex(ctx: ResolveContext, env: ResolverEnv, title: string): Promise<string[]> {
  const registryEnv: RegistryEnv = { fetch: env.fetch, logger: env.logger, contactEmail: ctx.contactEmail };
  const suggestions = await openAlexAutocomplete(registryEnv, title);
  const expected = { title, ...(ctx.authors?.length ? { authors: ctx.authors } : {}) };
  const hit = suggestions.find((s) => isSameWork({ title: s.title, ...(s.authors.length ? { authors: s.authors } : {}) }, expected));
  return hit ? openAlexCopies(ctx, env, hit.workId) : [];
}

// --- deriveCandidateVersion: Tells which version of the paper a candidate URL holds, from its source's label, its host or the resolver that proposed it.
const PREPRINT_SERVER = /(^|\.)(biorxiv|medrxiv)\.org$/i;

// OpenAlex locations and Unpaywall oa_locations share these labels.
const OA_LABELS: Record<string, PdfVersion> = {
  submittedVersion: "preprint",
  acceptedVersion: "accepted",
  publishedVersion: "published",
};

/**
 * Maps an OpenAlex or Unpaywall `version` label; anything else is unknown.
 * TRAP: both label some publishers' own PDFs `submittedVersion` (PLOS), so a publisher-hosted copy keeps no
 * pre-publication label.
 */
export function deriveVersionFromOaLabel(label: string | null | undefined, publisherHosted: boolean): PdfVersion | undefined {
  const version = label ? OA_LABELS[label] : undefined;
  return publisherHosted && version !== "published" ? undefined : version;
}

/** Records the version a lookup's source gave for a URL, for `candidateVersion` to read. */
export function addVersion(ctx: ResolveContext, url: string, version: PdfVersion | undefined): void {
  if (!version) return;
  ctx.versions ??= new Map();
  if (!ctx.versions.has(url)) ctx.versions.set(url, version);
}

/** True for a URL on arXiv, bioRxiv or medRxiv, which serve preprints only. */
export function isPreprintServerUrl(url: string): boolean {
  if (extractArxivIdentifierFromUrl(url)) return true;
  try {
    return PREPRINT_SERVER.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Lookups that read the article's own page or the publisher's URL scheme, not an aggregator's index.
const FROM_THE_ARTICLE = new Set(["page", "landing", "publisher"]);

/**
 * A preprint server's URL is a preprint. A link from the article's own page carries no aggregator label, because
 * aggregators file publishers' PDFs as repository preprints (PLOS); otherwise a source's label wins. A publisher rule's
 * URL is the published version.
 * @returns the version, or undefined when nothing says
 */
export function deriveCandidateVersion(ctx: ResolveContext, resolver: string, url: string): PdfVersion | undefined {
  if (isPreprintServerUrl(url)) return "preprint";
  if (resolver === "publisher") return "published";
  return FROM_THE_ARTICLE.has(resolver) ? undefined : ctx.versions?.get(url);
}

// --- pageHint: Proposes the PDF links the page itself offered: the tab when it is a PDF, an embedded viewer, citation_pdf_url, rel=alternate, anchors that name the paper.
export const pageHintResolver: PdfResolver = {
  name: "page",
  async resolve(ctx) {
    return ctx.pageCandidates.map((c) => c.url);
  },
};
