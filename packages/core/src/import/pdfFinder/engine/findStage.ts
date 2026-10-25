/** Starts every lookup at once, each under its own deadline, and hands their candidates out in rank order. */
import { isSupplementaryUrl } from "../client/index.js";
import { reportError } from "../env.js";
import { outranksVersion, type PdfVersion } from "../../../model/index.js";
import {
  candidateVersion,
  arxivResolver,
  crossrefResolver,
  europePmcResolver,
  openalexResolver,
  pageHintResolver,
  pmcResolver,
  publisherResolver,
  customResolver,
  semanticScholarResolver,
  titleTwinResolver,
  unpaywallResolver,
} from "../resolvers/index.js";
import type { PdfFetchOptions, PdfResolver, ResolveContext, ResolverEnv } from "../pdfResolver.js";
import { deadline } from "./deadline.js";
import { fetchLandingPage } from "../../landing/index.js";

interface LookupStep {
  resolver: PdfResolver;
  /** Lookups whose answers this one reads off the context, so it starts once they settle. */
  after?: readonly PdfResolver[];
}

const LEARNERS = [openalexResolver, semanticScholarResolver, europePmcResolver, titleTwinResolver];

// INVARIANT: learners (OpenAlex, Semantic Scholar, Europe PMC, the title-only twin search) settle before PMC and the
// second arXiv step, so the ids they reveal feed those; the publisher rules wait for the landing page, whose URL keys some platforms.
// arXiv appears twice: an id known from the start downloads early, a learned one later; a URL is tried once.
function lookupPlan(landing: PdfResolver): LookupStep[] {
  return [
    { resolver: pageHintResolver },
    { resolver: landing },
    { resolver: publisherResolver, after: [landing] },
    { resolver: arxivResolver },
    ...LEARNERS.map((resolver) => ({ resolver })),
    { resolver: arxivResolver, after: LEARNERS },
    { resolver: pmcResolver, after: LEARNERS },
    { resolver: crossrefResolver },
    { resolver: unpaywallResolver },
    { resolver: customResolver },
  ];
}

// The lookup cap cuts it first; this only bounds a host that ignores the abort.
const PAGE_TIMEOUT_MS = 10_000;

/** A resolver that reads the DOI's landing page with the download's cookies and headers, since publishers gate it like the PDF. */
function landingLookup(settings: Pick<PdfFetchOptions, "credentials" | "headers">): PdfResolver {
  return {
    name: "landing",
    async resolve(ctx, env) {
      if (ctx.landingUrl || !ctx.doi) return [];
      const facts = await fetchLandingPage(`https://doi.org/${ctx.doi}`, {
        fetch: env.fetch,
        timeoutMs: PAGE_TIMEOUT_MS,
        logger: env.logger,
        ...(settings.credentials ? { credentials: settings.credentials } : {}),
        ...(settings.headers ? { headers: settings.headers } : {}),
      });
      if (!facts) return [];
      // Publisher rules key some platforms by the landing URL, and downloads send it as Referer.
      ctx.landingUrl = facts.pageUrl;
      return facts.pdfCandidates.map((c) => c.url);
    },
  };
}

/** A URL to download, labelled with whoever proposed it and, when known, the version of the paper it holds. */
export interface Candidate {
  url: string;
  source: string;
  version?: PdfVersion;
}

/**
 * Starts the lookups in `lookupPlan`; a step with `after` starts once those settle. Each lookup is cut at `capMs` from
 * its own start, and all of them when `runSignal` aborts.
 * @returns each step's candidates, in rank order, without those `ctx.betterThan` rules out; a step that fails or is cut
 * yields []
 */
export function startLookups(
  ctx: ResolveContext,
  opts: PdfFetchOptions,
  env: ResolverEnv,
  capMs: number,
  runSignal: AbortSignal,
): Array<Promise<Candidate[]>> {
  const settled = new Map<PdfResolver, Promise<string[]>>();
  return lookupPlan(landingLookup(opts)).map((step) => {
    const ready = Promise.all((step.after ?? []).map((r) => settled.get(r)));
    const answer = ready.then(() => cappedLookup(step.resolver, ctx, env, capMs, runSignal));
    if (!settled.has(step.resolver)) settled.set(step.resolver, answer);
    return answer.then((urls) => urls.map((url) => candidate(ctx, step.resolver, url)).filter((c) => wanted(ctx, c)));
  });
}

/** Yields each new candidate once its step and every step ranked above it have answered. */
export async function* rankedCandidates(steps: Array<Promise<Candidate[]>>): AsyncGenerator<Candidate, void, undefined> {
  const seen = new Set<string>();
  for (const step of steps) {
    for (const candidate of await step) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      // An aggregator can list a supplement as the paper's PDF; it would download fine and be the wrong document.
      if (!isSupplementaryUrl(candidate.url)) yield candidate;
    }
  }
}

async function candidatesOf(resolver: PdfResolver, ctx: ResolveContext, env: ResolverEnv): Promise<string[]> {
  try {
    return await resolver.resolve(ctx, env);
  } catch (error) {
    reportError(env, error, { resolver: resolver.name });
    return [];
  }
}

// The cap aborts the lookup's requests, so a late answer arrives as a failed request and the resolver yields [].
async function cappedLookup(
  resolver: PdfResolver, ctx: ResolveContext, env: ResolverEnv, capMs: number, runSignal: AbortSignal,
): Promise<string[]> {
  const cap = deadline(capMs, `Lookup over ${capMs} ms`);
  const signal = AbortSignal.any([cap.signal, runSignal]);
  const fetch: ResolverEnv["fetch"] = (input, init) =>
    env.fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
  try {
    return await candidatesOf(resolver, ctx, { ...env, fetch });
  } finally {
    cap.clear();
  }
}

function candidate(ctx: ResolveContext, resolver: PdfResolver, url: string): Candidate {
  const version = candidateVersion(ctx, resolver.name, url);
  return { url, source: sourceLabel(resolver, ctx, url), ...(version ? { version } : {}) };
}

function wanted(ctx: ResolveContext, c: Candidate): boolean {
  return !ctx.betterThan || outranksVersion(c.version, ctx.betterThan);
}

// Page links keep the label of whoever offered them ("page", "scholar").
function sourceLabel(resolver: PdfResolver, ctx: ResolveContext, url: string): string {
  return resolver.name === "page" ? ctx.pageCandidates.find((c) => c.url === url)?.source ?? resolver.name : resolver.name;
}
