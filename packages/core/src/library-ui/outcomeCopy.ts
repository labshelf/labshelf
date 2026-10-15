/** Defines the notice wording for batch paper changes (status, tags, move, remove) on every host. */
import { ROOT_LABEL } from "../library/model/index.js";

export interface BatchFailure {
  id: string;
  error: string;
}

export interface OutcomeNotice {
  kind: "ok" | "error";
  text: string;
}

/** "1 paper" / "3 papers". */
export function papersLabel(n: number): string {
  return `${n} paper${n === 1 ? "" : "s"}`;
}

/** Trims tags and drops empty ones. */
export function cleanTags(tags: readonly string[]): string[] {
  return tags.map((t) => t.trim()).filter(Boolean);
}

/** The error notice for papers whose status or tags could not be written. */
export function keptFieldNotice(field: "status" | "tags", failed: number, error: string): string {
  return `${papersLabel(failed)} kept their ${field} — ${error}`;
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
  if (done > 0) return { kind: "ok", text: `${papersLabel(done)} moved to ${where ?? ROOT_LABEL}` };
  return undefined;
}

/** The notice after papers go to the trash, or undefined when nothing was removed and nothing failed. */
export function removeNotice(done: readonly string[], failed: readonly BatchFailure[], titleOf: (id: string) => string): OutcomeNotice | undefined {
  if (failed.length) return { kind: "error", text: partialFailure(done.length, "removed", failed, titleOf) };
  if (done.length === 1) return { kind: "ok", text: `Removed "${titleOf(done[0]!)}"` };
  if (done.length > 1) return { kind: "ok", text: `Removed ${papersLabel(done.length)}` };
  return undefined;
}
