// Writes a scenario's results and summaries as JSON beside the corpus.
import { writeFileSync } from "node:fs";
import { summarize, summarizeByCategory } from "./summarize.js";
import type { PaperResult, Scenario } from "../types.js";

/** @returns the path written, named by scenario and run time so runs can be compared */
export function writeReport(scenario: Scenario, results: PaperResult[], startedAt: Date): string {
  const stamp = startedAt.toISOString().slice(0, 16).replace(":", "-");
  const path = new URL(`../report-${scenario}-${stamp}.json`, import.meta.url);
  const report = { scenario, startedAt: startedAt.toISOString(), total: summarize(results), categories: summarizeByCategory(results), results };
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path.pathname;
}
