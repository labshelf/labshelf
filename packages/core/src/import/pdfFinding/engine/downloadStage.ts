/** Downloads ranked candidates a few at a time and keeps the best-ranked PDF, within the run's time limits. */
import { downloadPdf, type DownloadOutcome } from "../download/index.js";
import { reportError, warn } from "../env.js";
import type { PdfAttempt, PdfFetchOptions, ResolveContext, ResolvedPdf, ResolverEnv } from "../types.js";
import { deadline } from "./deadline.js";
import { pacedFetch } from "./domainPacer.js";
import type { EngineLimits } from "./limits.js";
import type { Candidate } from "./lookupStage.js";

export interface DownloadStageResult {
  found?: ResolvedPdf;
  /** URLs a bot check refused, best-ranked first, for a retry through a real tab. */
  blocked: string[];
}

/** A candidate a worker took; `outcome` is unset while its download is in flight. */
interface Taken {
  candidate: Candidate;
  outcome?: DownloadOutcome;
}

/**
 * Takes candidates in rank order, `limits.concurrency` at a time. The first PDF waits up to `limits.holdMs` for
 * better-ranked downloads still in flight, then the best-ranked PDF wins and the rest are cancelled. `attempts`
 * receives every finished download, in rank order.
 */
export async function downloadBest(
  ctx: ResolveContext,
  candidates: AsyncIterator<Candidate>,
  run: { opts: PdfFetchOptions; env: ResolverEnv; limits: EngineLimits },
  attempts: PdfAttempt[],
): Promise<DownloadStageResult> {
  const { opts, env, limits } = run;
  const stop = new AbortController();
  const total = deadline(limits.totalMs, "Download stage over its limit");
  const signal = AbortSignal.any([stop.signal, total.signal]);
  const pacedEnv: ResolverEnv = { ...env, fetch: pacedFetch(env.fetch, limits) };
  const taken: Taken[] = [];
  let workersDone = false;
  let wake = (): void => undefined;
  const changed = (): Promise<void> => new Promise((resolve) => { wake = resolve; });
  signal.addEventListener("abort", () => wake(), { once: true });

  const worker = async (): Promise<void> => {
    for (;;) {
      const next = await candidates.next();
      if (next.done || signal.aborted) return;
      // INVARIANT: the iterator answers queued calls in order, so `taken` stays in rank order.
      const entry: Taken = { candidate: next.value };
      taken.push(entry);
      entry.outcome = await download(next.value.url, ctx, opts, pacedEnv, limits, signal);
      wake();
    }
  };
  void Promise.all(Array.from({ length: limits.concurrency }, worker)).then(() => { workersDone = true; wake(); });

  const best = (): Taken | undefined => taken.find((t) => t.outcome?.pdf);
  const betterInFlight = (winner: Taken): boolean => taken.slice(0, taken.indexOf(winner)).some((t) => !t.outcome);
  const running = (): boolean => !workersDone && !signal.aborted;
  while (running() && !best()) await changed();
  const first = best();
  if (first && betterInFlight(first)) {
    let held = false;
    const timer = setTimeout(() => { held = true; wake(); }, limits.holdMs);
    while (running() && !held && betterInFlight(best()!)) await changed();
    clearTimeout(timer);
  }
  if (signal.aborted && !stop.signal.aborted) warn(env, "download stage reached its time limit", { totalMs: limits.totalMs });
  stop.abort();
  total.clear();
  return settle(taken, best(), attempts);
}

async function download(
  url: string, ctx: ResolveContext, opts: PdfFetchOptions, env: ResolverEnv, limits: EngineLimits, signal: AbortSignal,
): Promise<DownloadOutcome> {
  const perUrl = deadline(limits.perUrlMs, "Candidate over its limit");
  try {
    return await downloadPdf(url, opts, env, {
      signal: AbortSignal.any([signal, perUrl.signal]),
      firstByteMs: limits.firstByteMs,
      ...(ctx.landingUrl ? { referer: ctx.landingUrl } : {}),
    });
  } catch (error) {
    reportError(env, error, { url });
    return { blocked: [], outcome: "error" };
  } finally {
    perUrl.clear();
  }
}

// Downloads cut off by the winner or the time limit taught nothing, so they are not attempts.
function settle(taken: Taken[], winner: Taken | undefined, attempts: PdfAttempt[]): DownloadStageResult {
  const finished = taken.filter((t): t is Required<Taken> => t.outcome !== undefined);
  for (const { candidate, outcome } of finished) {
    attempts.push({ source: candidate.source, url: candidate.url, outcome: outcome.outcome, ...(outcome.status !== undefined ? { status: outcome.status } : {}) });
  }
  const blocked = finished.flatMap((t) => t.outcome.blocked);
  const pdf = winner?.outcome?.pdf;
  return pdf ? { found: { bytes: pdf.bytes, url: pdf.url, source: winner.candidate.source }, blocked } : { blocked };
}
