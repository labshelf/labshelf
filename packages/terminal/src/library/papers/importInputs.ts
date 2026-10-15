/** Sorts what the user typed in "add" into paths on this machine and inputs to import from the network (identifiers and links). */
import * as path from "node:path";

import type { MutationContext } from "@labshelf/core";

import { expandHome } from "../../platform/index.js";

export interface SortedInputs {
  /** Absolute paths that exist: files, folders, or entries the import reports as skipped. */
  local: string[];
  network: string[];
}

/** @returns the non-blank inputs, local paths resolved against the working directory */
export async function sortImportInputs(ctx: MutationContext, inputs: string[]): Promise<SortedInputs> {
  const sorted: SortedInputs = { local: [], network: [] };
  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) { continue; }
    const local = path.resolve(expandHome(input));
    if (await ctx.fs.exists(local)) { sorted.local.push(local); } else { sorted.network.push(input); }
  }
  return sorted;
}
