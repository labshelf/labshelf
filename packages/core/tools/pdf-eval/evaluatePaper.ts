// Runs one corpus paper through core's PDF finder in one scenario and judges the PDF it returns.
import { fetchLandingPage, findPaperPdf, identifiersFromInput } from "../../src/import/index.js";
import type { DetectedIds, PdfAttempt, PdfCandidate } from "../../src/import/index.js";
import { BROWSER_HEADERS, chromeFetch } from "./chromeFetch.js";
import { titleScoreOfPdf } from "./titleMatch.js";
import type { CorpusEntry, MissOutcome, PaperResult, Scenario } from "./types.js";

export const PAPER_TIMEOUT_MS = 30_000;
const CORRECT_SHARE = 0.6;

function idsOf(entry: CorpusEntry): DetectedIds {
  const ids: DetectedIds = {};
  for (const found of identifiersFromInput(entry.id)) {
    if (found.type === "doi") ids.doi = found.value;
    if (found.type === "arxiv") ids.arxivId = found.value;
    if (found.type === "pmid") ids.pmid = found.value;
  }
  return ids;
}

/** The "landing" scenario hands the finder what the app has after opening the article: the page's final URL and its PDF links. */
async function pageContext(entry: CorpusEntry, fetchFn: typeof fetch): Promise<{ landingUrl: string; pageCandidates: PdfCandidate[] }> {
  const facts = await fetchLandingPage(entry.landingUrl, { fetch: fetchFn, timeoutMs: PAPER_TIMEOUT_MS, headers: BROWSER_HEADERS });
  return { landingUrl: facts?.pageUrl ?? entry.landingUrl, pageCandidates: facts?.pdfCandidates ?? [] };
}

function missOutcome(attempts: PdfAttempt[], timedOut: boolean): MissOutcome {
  if (timedOut) return "timeout";
  return attempts[attempts.length - 1]?.outcome ?? "none";
}

export async function evaluatePaper(entry: CorpusEntry, scenario: Scenario): Promise<PaperResult> {
  const started = Date.now();
  const timeout = AbortSignal.timeout(PAPER_TIMEOUT_MS);
  const fetchFn = chromeFetch(timeout);
  const attempts: PdfAttempt[] = [];
  const base = { id: entry.id, title: entry.title, category: entry.category };
  try {
    const page = scenario === "landing" ? await pageContext(entry, fetchFn) : {};
    const found = await findPaperPdf(
      { fetch: fetchFn, headers: BROWSER_HEADERS },
      { ids: idsOf(entry), metadata: { title: entry.title }, input: entry.id, ...page },
      attempts,
    );
    if (!found) return { ...base, found: false, correct: false, missOutcome: missOutcome(attempts, timeout.aborted), attempts: attempts.length, ms: Date.now() - started };
    const titleScore = await titleScoreOfPdf(entry.title, found.bytes);
    return { ...base, found: true, correct: titleScore >= CORRECT_SHARE, titleScore, source: found.source, url: found.url, attempts: attempts.length, ms: Date.now() - started };
  } catch (error) {
    // A paper that crashes the finder is a miss, not the end of the run.
    console.error(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
    return { ...base, found: false, correct: false, missOutcome: timeout.aborted ? "timeout" : "error", attempts: attempts.length, ms: Date.now() - started };
  }
}
