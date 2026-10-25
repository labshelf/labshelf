// Holds the remote changes an editor does not show yet and moves the user's concurrent edits over them.
import { applyChanges, orderChanges, type TextChange } from "./textChange.js";

const CARRIAGE_RETURN = 13;

type Bias = "before" | "after";

/** Where `offset` lands once `changes` (sorted, all on one text) are applied; `bias` settles an offset at an insert point or inside a replaced range. */
function mapOffset(offset: number, changes: readonly TextChange[], bias: Bias): number {
  let delta = 0;
  for (const change of changes) {
    if (change.start > offset) { break; }
    if (change.end < offset || (change.end === offset && change.start < offset)) {
      delta += change.text.length - (change.end - change.start);
      continue;
    }
    return change.start + delta + (bias === "after" ? change.text.length : 0);
  }
  return offset + delta;
}

/** A range keeps the other side's inserts at its edges, so neither side deletes text it never saw. */
function rebaseChanges(changes: readonly TextChange[], over: readonly TextChange[], insertBias: Bias): TextChange[] {
  return orderChanges(changes).map(({ start, end, text }) => {
    if (start === end) {
      const at = mapOffset(start, over, insertBias);
      return { start: at, end: at, text };
    }
    const mappedStart = mapOffset(start, over, "after");
    return { start: mappedStart, end: Math.max(mappedStart, mapOffset(end, over, "before")), text };
  });
}

/** One replacement that turns `from` into `to`; it never splits a CRLF pair. */
export function deriveReplacementBetween(from: string, to: string): TextChange {
  const shorter = Math.min(from.length, to.length);
  let prefix = 0;
  while (prefix < shorter && from.charCodeAt(prefix) === to.charCodeAt(prefix)) { prefix++; }
  let suffix = 0;
  while (suffix < shorter - prefix
    && from.charCodeAt(from.length - 1 - suffix) === to.charCodeAt(to.length - 1 - suffix)) { suffix++; }
  if (prefix > 0 && from.charCodeAt(prefix - 1) === CARRIAGE_RETURN) { prefix--; }
  if (suffix > 0 && from.charCodeAt(from.length - suffix - 1) === CARRIAGE_RETURN) { suffix--; }
  return { start: prefix, end: from.length - suffix, text: to.slice(prefix, to.length - suffix) };
}

/** INVARIANT: applying every set in order to the editor text gives the target text. */
export class PendingRemoteChanges {
  private sets: TextChange[][] = [];

  get head(): readonly TextChange[] | undefined {
    return this.sets[0];
  }

  push(changes: readonly TextChange[]): void {
    if (changes.length > 0) { this.sets.push(orderChanges(changes)); }
  }

  /** The head set reached the editor. */
  shift(): void {
    this.sets.shift();
  }

  /** Replaces the sets by one replacement, for when the exact remote changes are unknown. */
  reset(editorText: string, targetText: string): void {
    this.sets = editorText === targetText ? [] : [[deriveReplacementBetween(editorText, targetText)]];
  }

  /** Moves `local`, made on the editor text before them, over the pending sets; returns it as changes to the target text. */
  rebase(local: readonly TextChange[], editorAfter: string, targetBefore: string): TextChange[] {
    let moving = orderChanges(local);
    const rebased: TextChange[][] = [];
    for (const set of this.sets) {
      // Remote text sits before local text typed at the same point, on both sides.
      rebased.push(rebaseChanges(set, moving, "before"));
      moving = rebaseChanges(moving, set, "after");
    }
    const targetAfter = applyChanges(targetBefore, moving);
    this.sets = rebased;
    // TRAP: moving overlapping ranges past each other does not always converge; the replacement does.
    if (this.sets.reduce(applyChanges, editorAfter) !== targetAfter) { this.reset(editorAfter, targetAfter); }
    return moving;
  }
}
