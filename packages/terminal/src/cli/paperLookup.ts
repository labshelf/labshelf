// Finds the paper a command argument names, by id or by cite key.
import type { PaperEntry } from "@labshelf/core";

import type { AppContext } from "../app/index.js";
import { UsageError } from "./usage.js";

export function requirePaper(ctx: AppContext, id: string): PaperEntry {
  const entry = ctx.store.paper(id) ?? [...ctx.store.snapshot.papers.values()].find((e) => e.record.citeKey === id);
  if (!entry) { throw new UsageError(`No paper with id "${id}"`); }
  return entry;
}
