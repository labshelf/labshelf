// What the native editor offers for linked outputs, free of VS Code: the actions of a link's state, the files and kinds Link Output… lists, the decimals it accepts and the sentence a run ends with.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { LINKABLE_OUTPUT_EXTENSIONS, extensionOf, type OutputKind, type OutputLink, type OutputLinkStatus, type OutputRunResult } from "@labshelf/core";

export type OutputAction = "run" | "update" | "link" | "settings";

/** A source linked here can run, and update a stale copy (or write a missing one); otherwise the one action is Link to code. */
export function deriveOutputActions(status: Pick<OutputLinkStatus, "state">): OutputAction[] {
  if (status.state === "unlinked") { return ["link"]; }
  return status.state === "stale" ? ["run", "update", "settings"] : ["run", "settings"];
}

/** The source files Link Output… can link, sorted. */
export const filterLinkableOutputs = (files: readonly string[]): string[] =>
  files.filter((path) => LINKABLE_OUTPUT_EXTENSIONS.includes(extensionOf(path))).sort((a, b) => a.localeCompare(b));

/** The kinds a file can be linked as, the first the default: CSV and TSV are tables, JSON is values or a table, the rest are copied as they are. */
export function deriveOutputKindChoices(path: string): OutputKind[] {
  const extension = extensionOf(path);
  if (extension === ".csv" || extension === ".tsv") { return ["table"]; }
  if (extension === ".json") { return ["values", "table"]; }
  return ["file"];
}

export const OUTPUT_KIND_LABELS: Record<OutputKind, string> = { file: "Figure or file", table: "Table", values: "Values" };

const MAX_DECIMALS = 10;

/** The decimals typed for a table: empty keeps numbers as written; anything but a whole number 0 to 10 is an error sentence. */
export function parseDecimalsInput(text: string): { decimals: number | undefined } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") { return { decimals: undefined }; }
  const decimals = Number(trimmed);
  return /^\d+$/.test(trimmed) && decimals <= MAX_DECIMALS ? { decimals } : { error: `Type a whole number from 0 to ${MAX_DECIMALS}, or leave it empty.` };
}

/** "Updated <when> by <who>" of a link, in the reader's locale. */
export function describeOutputUpdate(link: Pick<OutputLink, "updated" | "by">): string {
  const when = new Date(link.updated);
  const date = Number.isNaN(when.getTime()) ? link.updated : when.toLocaleString();
  return link.by ? `Updated ${date} by ${link.by}` : `Updated ${date}`;
}

/** What a finished run tells the user; undefined when there is nothing to say (cancelled or declined). */
export function describeOutputRun(updated: readonly string[], result: OutputRunResult): string | undefined {
  if (result.status !== "finished") { return undefined; }
  if (updated.length === 0) { return "Ran. No outputs changed."; }
  return updated.length === 1 ? "1 output updated." : `${updated.length} outputs updated.`;
}
