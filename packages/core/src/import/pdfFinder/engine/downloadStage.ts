/** Downloads ranked candidates a few at a time and keeps the best-ranked PDF, within the run's time limits. */
import { downloadPdf, type DownloadOutcome } from "../client/index.js";
import { reportError, reportWarning } from "../env.js";
import { compareVersions } from "../../../model/index.js";
import type { PdfAttempt, PdfFetchOptions, ResolveContext, ResolvedPdf, ResolverEnv } from "../pdfResolver.js";
import { createDeadline } from "./deadline.js";
import { createPacedFetch } from "./hostPacer.js";
import { runHelperTabRetry } from "./helperTabs.js";
import type { EngineLimits } from "./limits.js";
import type { Candidate } from "./findStage.js";

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
export async function downloadCandidate(
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
