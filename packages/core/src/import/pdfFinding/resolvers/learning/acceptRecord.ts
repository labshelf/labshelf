/**
 * Decides whether a record returned by an aggregator is for the paper being searched. Aggregators attach a
 * neighbouring paper's locations to a correct DOI often enough that nothing from a record is used unless it passes
 * `sameWork` against the context's title. Without a title there is nothing to check, so the record is accepted.
 */
import { sameWork } from "../../../resolution/index.js";
import type { WorkRef } from "../../../resolution/index.js";
import { warn } from "../../env.js";
import type { ResolveContext, ResolverEnv } from "../../types.js";

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
