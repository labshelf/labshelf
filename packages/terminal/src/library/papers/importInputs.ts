/** Sorts what the user typed in "add" into PDF files, network inputs (identifiers and links) and inputs there is nothing to import from. */
import * as path from "node:path";

import { discoverPdfs, type MutationContext } from "@labshelf/core";

export interface ImportItem {
  kind: "pdf" | "network" | "skipped";
  value: string;
}

/** @returns one item per PDF found under the inputs, per input to import from the network and per input that is not importable */
export async function planImports(ctx: MutationContext, inputs: string[]): Promise<ImportItem[]> {
  const items: ImportItem[] = [];
  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) { continue; }
    const local = path.resolve(input.replace(/^~(?=$|\/)/, process.env["HOME"] ?? "~"));
    if (await ctx.fs.exists(local)) {
      const found = await discoverPdfs(ctx, [local]);
      items.push(...found.pdfs.map((value): ImportItem => ({ kind: "pdf", value })));
      items.push(...found.skipped.map((value): ImportItem => ({ kind: "skipped", value: input })));
    } else {
      items.push({ kind: "network", value: input });
    }
  }
  return items;
}
