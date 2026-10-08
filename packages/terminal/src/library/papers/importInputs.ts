/** Sorts what the user typed in "add" into PDF files, PDF URLs, identifiers and inputs there is nothing to import from. */
import * as path from "node:path";

import { discoverPdfs, identifiersFromInput, type MutationContext } from "@labshelf/core";

export interface ImportItem {
  kind: "pdf" | "url" | "identifier" | "skipped";
  value: string;
}

/** @returns one item per PDF found under the inputs, per URL, per identifier and per input that is not importable */
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
    } else if (/^https?:\/\//i.test(input) && identifiersFromInput(input).length === 0) {
      items.push({ kind: "url", value: input });
    } else {
      items.push({ kind: "identifier", value: input });
    }
  }
  return items;
}
