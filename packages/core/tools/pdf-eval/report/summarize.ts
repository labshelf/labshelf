// Aggregates paper results into per-category and total counts, miss outcomes and median times.
import type { MissOutcome, PaperResult } from "../types.js";

export interface Summary {
  papers: number;
  correct: number;
  wrong: number;
  misses: number;
  missesByOutcome: Partial<Record<MissOutcome, number>>;
  /** Median milliseconds for papers whose PDF was found (right or wrong); undefined when none was. */
  medianFoundMs?: number;
  medianNotFoundMs?: number;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function summarize(results: PaperResult[]): Summary {
  const found = results.filter((r) => r.found);
  const missed = results.filter((r) => !r.found);
  const missesByOutcome: Summary["missesByOutcome"] = {};
  for (const miss of missed) {
    const outcome = miss.missOutcome ?? "none";
    missesByOutcome[outcome] = (missesByOutcome[outcome] ?? 0) + 1;
  }
  const medianFoundMs = median(found.map((r) => r.ms));
  const medianNotFoundMs = median(missed.map((r) => r.ms));
  return {
    papers: results.length,
    correct: results.filter((r) => r.correct).length,
    wrong: found.length - results.filter((r) => r.correct).length,
    misses: missed.length,
    missesByOutcome,
    ...(medianFoundMs !== undefined ? { medianFoundMs } : {}),
    ...(medianNotFoundMs !== undefined ? { medianNotFoundMs } : {}),
  };
}

export function summarizeByCategory(results: PaperResult[]): Record<string, Summary> {
  const categories = [...new Set(results.map((r) => r.category))];
  return Object.fromEntries(categories.map((category) => [category, summarize(results.filter((r) => r.category === category))]));
}
