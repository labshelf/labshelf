/** Defines the notice wording for batch paper changes (status, tags, move, remove) on every host. */
import { ROOT_LABEL } from "../library/model/index.js";
import { formatCount } from "../ui/index.js";

export interface BatchFailure {
  id: string;
  error: string;
}

export interface OutcomeNotice {
  kind: "ok" | "error";
  text: string;
}

/** "1 paper" / "3 papers". */
export function formatPaperCount(n: number): string {
  return formatCount(n, "paper");
}

/** Trims tags and drops empty ones. */
export function deriveCleanTags(tags: readonly string[]): string[] {
  return tags.map((t) => t.trim()).filter(Boolean);
}

/** The error notice for papers whose status or tags could not be written. */
export function formatKeptFieldNotice(field: "status" | "tags", failed: number, error: string): string {
  return `${formatPaperCount(failed)} kept their ${field} — ${error}`;
}

// `0 moved, 2 failed — "Title" — reason`: names the first failing paper so the user can find it.
function partialFailure(done: number, doneVerb: string, failed: readonly BatchFailure[], titleOf: (id: string) => string): string {
  const first = failed[0]!;
  return `${done} ${doneVerb}, ${failed.length} failed — "${titleOf(first.id)}" — ${first.error}`;
}

/** The notice after a move, or undefined when nothing moved and nothing failed. `where` is a folder name, or undefined for the root. */
export function moveNotice(
  done: number, failed: readonly BatchFailure[], where: string | undefined, titleOf: (id: string) => string,
): OutcomeNotice | undefined {
  if (failed.length) return { kind: "error", text: partialFailure(done, "moved", failed, titleOf) };
  if (done > 0) return { kind: "ok", text: `${formatPaperCount(done)} moved to ${where ?? ROOT_LABEL}` };
  return undefined;
}

/** The notice after papers go to the trash, or undefined when nothing was removed and nothing failed. */
export function removeNotice(done: readonly string[], failed: readonly BatchFailure[], titleOf: (id: string) => string): OutcomeNotice | undefined {
  if (failed.length) return { kind: "error", text: partialFailure(done.length, "removed", failed, titleOf) };
  if (done.length === 1) return { kind: "ok", text: `Removed "${titleOf(done[0]!)}"` };
  if (done.length > 1) return { kind: "ok", text: `Removed ${formatPaperCount(done.length)}` };
  return undefined;
}
