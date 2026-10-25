// Decides whether an aggregator record is for the paper being searched.
import { sameWork } from "../../paper/index.js";
import type { WorkRef } from "../../paper/index.js";
import { warn } from "../env.js";
import type { ResolveContext, ResolverEnv } from "../pdfResolver.js";

// TRAP: aggregators often attach a neighbouring paper's locations to a correct DOI, so a record must pass `sameWork` against the title.
// Without a title there is nothing to check and the record is accepted.

export function acceptRecord(source: string, ctx: ResolveContext, env: ResolverEnv, record: WorkRef): boolean {
  if (!ctx.title) return true;
  const expected: WorkRef = {
    title: ctx.title,
    year: ctx.year,
    ...(ctx.authors ? { authors: ctx.authors } : {}),
  };
  if (sameWork(record, expected)) return true;
  warn(env, "record is not the searched paper, ignoring it", { source, found: record.title ?? null, expected: ctx.title });
  return false;
}
