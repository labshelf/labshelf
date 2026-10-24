// Formats parsed agent transcripts as a compact text report with budget flags.
import { BUDGETS } from './budgets.mjs';

const TOP_RESULTS = 5;
const TOP_READS = 5;

const k = (tokens) => `${(tokens / 1000).toFixed(1)}k`;
const shortPath = (path) => path.split('/').slice(-3).join('/');

function block(label, stats, budget, reports) {
  const flag = stats.peak > budget ? `  OVER ${budget / 1000}k BUDGET` : '';
  const lines = [`${label} — peak ${k(stats.peak)}, final ${k(stats.final)}, ${stats.turns} turns, baseline ${k(stats.baseline)}, plan reads ${stats.planReads}, report ${reports ? k(stats.reportTokens) : '—'}${flag}`];
  const top = [...stats.toolCalls].sort((a, b) => b.tokens - a.tokens).slice(0, TOP_RESULTS);
  if (top.length) lines.push(`  big: ${top.map((c) => `${c.tool} ${c.summary.slice(0, 40)} ≈${k(c.tokens)}`).join(' | ')}`);
  if (stats.repeatedReads.length) {
    lines.push(`  re-read: ${stats.repeatedReads.slice(0, TOP_READS).map((r) => `${shortPath(r.path)}×${r.count}`).join(', ')}`);
  }
  return lines;
}

// main: stats of the main thread; agents: [{ description, type, stats }].
export function formatReport({ main, agents }) {
  const sorted = [...agents].sort((a, b) => b.stats.peak - a.stats.peak);
  return [
    ...block('main thread', main, BUDGETS.main, false),
    ...sorted.flatMap((agent) => block(`${agent.type}: ${agent.description}`, agent.stats, BUDGETS.subagent, true)),
  ].join('\n');
}
