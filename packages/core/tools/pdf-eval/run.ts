// Runs the PDF-finding corpus in the "ids" and "landing" scenarios, prints the report and writes it beside the corpus.
// Usage: pnpm --filter @labshelf/core eval:pdf [--scenario ids|landing|both] [--limit N] [--concurrency N]
import { readFileSync } from "node:fs";
import { evaluatePaper } from "./evaluatePaper.js";
import { printReport, writeReport } from "./report/index.js";
import type { CorpusEntry, PaperResult, Scenario } from "./types.js";

const DEFAULT_CONCURRENCY = 4;
const SCENARIOS: Scenario[] = ["ids", "landing"];

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}

function chosenScenarios(): Scenario[] {
  const wanted = option("scenario");
  if (!wanted || wanted === "both") return SCENARIOS;
  if (wanted === "ids" || wanted === "landing") return [wanted];
  throw new Error(`--scenario must be ids, landing or both, got "${wanted}"`);
}

/** Runs `work` over `items`, `size` at a time, keeping results in input order. */
async function inBatches<T, R>(items: T[], size: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) results[index] = await work(items[index] as T, index);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

async function runScenario(scenario: Scenario, corpus: CorpusEntry[], concurrency: number): Promise<void> {
  const startedAt = new Date();
  const results: PaperResult[] = await inBatches(corpus, concurrency, async (entry, index) => {
    const result = await evaluatePaper(entry, scenario);
    const verdict = result.correct ? "ok" : result.found ? "WRONG" : `miss(${result.missOutcome})`;
    console.log(`[${scenario} ${index + 1}/${corpus.length}] ${verdict} ${entry.id} ${(result.ms / 1000).toFixed(1)}s`);
    return result;
  });
  printReport(scenario, results);
  console.log(`report: ${writeReport(scenario, results, startedAt)}`);
}

const limit = Number(option("limit") ?? Infinity);
const concurrency = Number(option("concurrency") ?? DEFAULT_CONCURRENCY);
const corpus = (JSON.parse(readFileSync(new URL("./corpus.json", import.meta.url), "utf8")) as CorpusEntry[]).slice(0, limit);
for (const scenario of chosenScenarios()) await runScenario(scenario, corpus, concurrency);
