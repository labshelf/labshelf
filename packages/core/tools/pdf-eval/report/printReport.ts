// Prints a scenario's per-category and total results as a text table, and lists the wrong PDFs.
import { summarize, summarizeByCategory } from "./summarize.js";
import type { Summary } from "./summarize.js";
import type { PaperResult, Scenario } from "../types.js";

const seconds = (ms: number | undefined): string => (ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}s`);

function row(label: string, s: Summary): string {
  const misses = Object.entries(s.missesByOutcome).map(([outcome, count]) => `${outcome}:${count}`).join(" ") || "-";
  return `${label.padEnd(24)}${String(s.correct).padStart(3)}/${String(s.papers).padEnd(3)} wrong ${String(s.wrong).padEnd(3)} miss ${String(s.misses).padEnd(3)} found ${seconds(s.medianFoundMs).padEnd(7)} not-found ${seconds(s.medianNotFoundMs).padEnd(7)} ${misses}`;
}

export function printReport(scenario: Scenario, results: PaperResult[]): void {
  console.log(`\n=== scenario: ${scenario} (correct/papers, wrong, misses, median time to found / not found, misses by last outcome) ===`);
  for (const [category, summary] of Object.entries(summarizeByCategory(results))) console.log(row(category, summary));
  console.log(row("TOTAL", summarize(results)));
  for (const wrong of results.filter((r) => r.found && !r.correct)) {
    console.log(`  wrong: ${wrong.id} via ${wrong.source} ${wrong.url} (title words ${Math.round((wrong.titleScore ?? 0) * 100)}%)`);
  }
}
