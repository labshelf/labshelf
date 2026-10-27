/** Runs the PDF finder's stages: concurrent lookups, ranked and paced downloads, then the sign-in retry. */
import { downloadPdf, isSupplementaryUrl, createProxiedUrl, type DownloadOutcome } from "./client.js";
import { runHelperTabRetry, type EngineLimits } from "./deadline.js";
import { createPacedFetch } from "./hostPacer.js";
import {
  deriveOrigin,
  deriveSite,
  parseHttpUrl,
  reportError,
  reportMessage,
  reportWarning,
  type LibraryProxy,
  type PdfAttempt,
  type PdfFetchOptions,
  type PdfResolver,
  type ResolveContext,
  type ResolvedPdf,
  type ResolverEnv,
} from "./finder.js";
import { arxivResolver, crossrefResolver, semanticScholarResolver } from "./indexes.js";
import { deriveCandidateVersion, pageHintResolver, titleTwinResolver } from "./matching.js";
import { customResolver, europePmcResolver, openalexResolver, pmcResolver, publisherResolver, unpaywallResolver } from "./openAccess.js";
import { deriveHostAccess } from "./rules.js";
import { createDeadline } from "../../async/index.js";
import { compareVersions, isPreferredVersion, type PdfVersion } from "../../model/index.js";
import { fetchLanding } from "../pageFacts.js";

// Starts every lookup at once, each under its own deadline, and hands their candidates out in rank order.
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
      const facts = await fetchLanding(`https://doi.org/${ctx.doi}`, {
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
export function startFinds(
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
export async function* walkRankedCandidates(steps: Array<Promise<Candidate[]>>): AsyncGenerator<Candidate, void, undefined> {
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
  const cap = createDeadline(capMs, `Lookup over ${capMs} ms`);
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
  const version = deriveCandidateVersion(ctx, resolver.name, url);
  return { url, source: sourceLabel(resolver, ctx, url), ...(version ? { version } : {}) };
}

function wanted(ctx: ResolveContext, c: Candidate): boolean {
  return !ctx.betterThan || isPreferredVersion(c.version, ctx.betterThan);
}

// Page links keep the label of whoever offered them ("page", "scholar").
function sourceLabel(resolver: PdfResolver, ctx: ResolveContext, url: string): string {
  return resolver.name === "page" ? ctx.pageCandidates.find((c) => c.url === url)?.source ?? resolver.name : resolver.name;
}

// Downloads ranked candidates a few at a time and keeps the best-ranked PDF, within the run's time limits.
/**
 * A candidate a worker took; `outcome` is unset while its download is in flight, and while a helper tab retries the
 * wall it hit (`walled`).
 */
interface Taken {
  candidate: Candidate;
  outcome?: DownloadOutcome;
  walled?: DownloadOutcome;
}

/**
 * Takes candidates in rank order, `limits.concurrency` at a time. A candidate that hits a bot wall is retried through
 * the host's helper tab at once, without holding a download slot. A PDF ranks by its version first (published and
 * unlabelled, then accepted, then preprint), then by rank order. The first PDF waits up to `limits.holdMs` for
 * better-ranking downloads still in flight, then the best PDF wins and the rest are cancelled. `attempts`
 * receives every finished download, in rank order.
 */
export async function downloadBest(
  ctx: ResolveContext,
  candidates: AsyncIterator<Candidate>,
  run: { opts: PdfFetchOptions; env: ResolverEnv; limits: EngineLimits },
  attempts: PdfAttempt[],
): Promise<ResolvedPdf | undefined> {
  const { opts, env, limits } = run;
  const stop = new AbortController();
  const total = createDeadline(limits.totalMs, "Download stage over its limit");
  const signal = AbortSignal.any([stop.signal, total.signal]);
  const pacedEnv: ResolverEnv = { ...env, fetch: createPacedFetch(env.fetch, limits) };
  const taken: Taken[] = [];
  const retry = opts.viaHelperTab ? runHelperTabRetry(opts.viaHelperTab, env, limits.helperTabSites) : undefined;
  let workersDone = false;
  let inTabs = 0;
  const { changed, wake } = wakeup(signal);

  const worker = async (): Promise<void> => {
    for (;;) {
      const next = await candidates.next();
      if (next.done || signal.aborted) return;
      // INVARIANT: the iterator answers queued calls in order, so `taken` stays in rank order.
      const entry: Taken = { candidate: next.value };
      taken.push(entry);
      const outcome = await downloadCandidate(next.value.url, ctx.landingUrl, opts, pacedEnv, limits, signal);
      if (retry && outcome.outcome === "bot" && outcome.blocked.length) void throughTab(entry, outcome);
      else entry.outcome = outcome;
      wake();
    }
  };
  const throughTab = async (entry: Taken, walled: DownloadOutcome): Promise<void> => {
    entry.walled = walled;
    inTabs++;
    const pdf = await retry!(walled.blocked, signal);
    entry.outcome = pdf ? { pdf, blocked: [], outcome: "pdf" } : walled;
    inTabs--;
    wake();
  };
  void Promise.all(Array.from({ length: limits.concurrency }, worker)).then(() => { workersDone = true; wake(); });

  const running = (): boolean => (!workersDone || inTabs > 0) && !signal.aborted;
  const winner = await pickWinner(taken, running, { changed, wake }, limits.holdMs);
  if (signal.aborted && !stop.signal.aborted) reportWarning(env, "download stage reached its time limit", { totalMs: limits.totalMs });
  stop.abort();
  total.clear();
  return settle(taken, winner, attempts);
}

interface Waker {
  /** Resolves at the next report from a worker or a tab, or when the stage is aborted. */
  changed(): Promise<void>;
  wake(): void;
}

function wakeup(signal: AbortSignal): Waker {
  let wake = (): void => undefined;
  signal.addEventListener("abort", () => wake(), { once: true });
  return { changed: () => new Promise((resolve) => { wake = resolve; }), wake: () => wake() };
}

// The best PDF by version, then rank order, after waiting up to `holdMs` for better downloads still in flight: those
// ranked above it, and those below it whose label says they are a better version. An unlabelled copy ranked below a
// preprint is not worth the wait; most are the wrong file or HTML.
async function pickWinner(taken: Taken[], running: () => boolean, { changed, wake }: Waker, holdMs: number): Promise<Taken | undefined> {
  const outranks = (a: Taken, b: Taken): boolean =>
    (compareVersions(a.candidate.version, b.candidate.version) || taken.indexOf(a) - taken.indexOf(b)) < 0;
  const best = (): Taken | undefined =>
    taken.filter((t) => t.outcome?.pdf).reduce<Taken | undefined>((top, t) => (!top || outranks(t, top) ? t : top), undefined);
  const worthWaiting = (t: Taken, winner: Taken): boolean =>
    outranks(t, winner) && (taken.indexOf(t) < taken.indexOf(winner) || t.candidate.version !== undefined);
  const betterInFlight = (winner: Taken): boolean => taken.some((t) => !t.outcome && worthWaiting(t, winner));
  while (running() && !best()) await changed();
  const first = best();
  if (first && betterInFlight(first)) {
    let held = false;
    const timer = setTimeout(() => { held = true; wake(); }, holdMs);
    while (running() && !held && betterInFlight(best()!)) await changed();
    clearTimeout(timer);
  }
  return best();
}

/** Downloads one candidate URL under its own deadline; a failure is logged and reported as an `error` outcome. */
async function downloadCandidate(
  url: string, referer: string | undefined, opts: PdfFetchOptions, env: ResolverEnv, limits: EngineLimits, signal: AbortSignal,
): Promise<DownloadOutcome> {
  const perUrl = createDeadline(limits.perUrlMs, "Candidate over its limit");
  try {
    return await downloadPdf(url, opts, env, {
      signal: AbortSignal.any([signal, perUrl.signal]),
      firstByteMs: limits.firstByteMs,
      ...(referer ? { referer } : {}),
    });
  } catch (error) {
    reportError(env, error, { url });
    return { blocked: [], outcome: "error" };
  } finally {
    perUrl.clear();
  }
}

// Downloads cut off by the winner or the time limit taught nothing, so they are not attempts; a wall whose tab was cut
// off still counts, because it tells the user what stood in the way.
function settle(taken: Taken[], winner: Taken | undefined, attempts: PdfAttempt[]): ResolvedPdf | undefined {
  for (const { candidate, outcome, walled } of taken) {
    const ended = outcome ?? walled;
    if (!ended) continue;
    attempts.push({ source: candidate.source, url: candidate.url, outcome: ended.outcome, ...(ended.status !== undefined ? { status: ended.status } : {}) });
  }
  const pdf = winner?.outcome?.pdf;
  if (!pdf) return undefined;
  const { source, version } = winner.candidate;
  return { bytes: pdf.bytes, url: pdf.url, source, ...(version ? { version } : {}) };
}

// Retries the publisher pages that asked for a sign-in, through the user's real browser and then the library's proxies.
/**
 * The `login` attempts on the article's own site or on a paywalled platform of the rule table, best-ranked first and
 * each URL once. A repository or an open-access platform that refuses a page is not one a library can open.
 */
function signInPages(attempts: readonly PdfAttempt[], landingUrl: string | undefined): PdfAttempt[] {
  const articleSite = landingUrl ? deriveSite(landingUrl) : undefined;
  const seen = new Set<string>();
  return attempts.filter((a) => {
    const host = parseHttpUrl(a.url)?.hostname;
    if (a.outcome !== "login" || a.proxy !== undefined || !host || seen.has(a.url)) return false;
    seen.add(a.url);
    const access = deriveHostAccess(host);
    return access === "paywalled" || (access === undefined && articleSite !== undefined && deriveSite(a.url) === articleSite);
  });
}

// A library that opens one page of a platform opens the rest, so each proxy gets only the few best-ranked pages.
const PAGES_PER_PROXY = 3;

interface AccessRun {
  opts: PdfFetchOptions;
  env: ResolverEnv;
  limits: EngineLimits;
}

/**
 * Runs once the open-access candidates found nothing. Each sign-in page goes through the host's helper tab, whose
 * session may hold an institutional login that background requests lack, then through each enabled proxy in order.
 * Proxied tries are appended to `attempts` with the proxy's name.
 */
export async function runBestAccess(ctx: ResolveContext, run: AccessRun, attempts: PdfAttempt[]): Promise<ResolvedPdf | undefined> {
  const proxies = (run.opts.proxies ?? []).filter((p) => p.enabled);
  const pages = signInPages(attempts, ctx.landingUrl);
  if (!pages.length || (!run.opts.viaHelperTab && !proxies.length)) return undefined;
  reportMessage(run.env, "retrying sign-in pages", { pages: pages.map((p) => p.url), proxies: proxies.map((p) => p.name) });
  const total = createDeadline(run.limits.totalMs, "Access stage over its limit");
  try {
    return (await throughHelperTabs(pages, run, total.signal)) ?? (await throughProxies(pages, proxies, run, total.signal, attempts));
  } finally {
    total.clear();
  }
}

async function throughHelperTabs(pages: PdfAttempt[], { opts, env, limits }: AccessRun, signal: AbortSignal): Promise<ResolvedPdf | undefined> {
  if (!opts.viaHelperTab) return undefined;
  const retry = runHelperTabRetry(opts.viaHelperTab, env, limits.helperTabSites);
  for (const site of new Set(pages.map((p) => deriveOrigin(p.url)))) {
    const onSite = pages.filter((p) => deriveOrigin(p.url) === site);
    const pdf = await retry(onSite.map((p) => p.url), signal);
    if (pdf) return { bytes: pdf.bytes, url: pdf.url, source: onSite[0]!.source };
  }
  return undefined;
}

async function throughProxies(
  pages: PdfAttempt[], proxies: LibraryProxy[], { opts, env, limits }: AccessRun, signal: AbortSignal, attempts: PdfAttempt[],
): Promise<ResolvedPdf | undefined> {
  const pacedEnv: ResolverEnv = { ...env, fetch: createPacedFetch(env.fetch, limits) };
  for (const proxy of proxies) {
    for (const page of pages.slice(0, PAGES_PER_PROXY)) {
      if (signal.aborted) return undefined;
      const url = createProxiedUrl(proxy.template, page.url);
      if (!url) {
        reportWarning(env, "library proxy template unreadable", { proxy: proxy.name, template: proxy.template });
        break;
      }
      const got = await downloadCandidate(url, undefined, opts, pacedEnv, limits, signal);
      attempts.push({ source: page.source, url, outcome: got.outcome, ...(got.status !== undefined ? { status: got.status } : {}), proxy: proxy.name });
      if (got.pdf) return { bytes: got.pdf.bytes, url: got.pdf.url, source: page.source };
      // A proxy that asks for its own sign-in, or walls the run off, answers every page the same way.
      if (got.outcome === "login" || got.outcome === "bot") break;
    }
  }
  return undefined;
}
