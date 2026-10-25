// Decides whether an aggregator record is for the paper being searched.
import { isSameWork } from "../../paper/index.js";
import type { WorkReference } from "../../paper/index.js";
import { reportWarning } from "../env.js";
import type { ResolveContext, ResolverEnv } from "../pdfResolver.js";

// TRAP: aggregators often attach a neighbouring paper's locations to a correct DOI, so a record must pass `sameWork` against the title.
// Without a title there is nothing to check and the record is accepted.

export function matchWork(source: string, ctx: ResolveContext, env: ResolverEnv, record: WorkReference): boolean {
  if (!ctx.title) return true;
  const expected: WorkReference = {
    title: ctx.title,
    year: ctx.year,
    ...(ctx.authors ? { authors: ctx.authors } : {}),
  };
  if (isSameWork(record, expected)) return true;
  reportWarning(env, "record is not the searched paper, ignoring it", { source, found: record.title ?? null, expected: ctx.title });
  return false;
}
