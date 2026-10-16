/** Starts every lookup at once, each under its own deadline, and hands their candidates out in rank order. */
import { isSupplementaryUrl } from "../download/index.js";
import { reportError } from "../env.js";
import { outranksVersion, type PdfVersion } from "../../../model/index.js";
import { candidateVersion } from "../resolvers/index.js";
import type { PdfFetchOptions, PdfResolver, ResolveContext, ResolverEnv } from "../types.js";
import { deadline } from "./deadline.js";
import { landingLookup } from "./landingLookup.js";
import { lookupPlan } from "./lookupPlan.js";

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
