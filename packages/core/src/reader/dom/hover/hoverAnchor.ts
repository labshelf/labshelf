/** Declares what a pending or visible hover popup belongs to, and what it shows. */
import type { InTextRef } from "../../text/index.js";
import type { ReaderContext } from "../session/index.js";

export type ExplicitDest = Parameters<ReaderContext["linkService"]["goToDestination"]>[0];

export interface HoverTarget {
  /** Every element of the target: a link, or the text runs of a reference — OCR text is one run per word, and crossing words must neither restart nor close the popup. */
  group: Element[];
  /** The reference inside those runs; tells two references in one long run apart. Null for a link annotation. */
  ref: InTextRef | null;
  /** Where the reference sits on screen, for placing the popup. */
  rect(): DOMRect;
}

export interface PopupContent {
  title: string;
  body: HTMLElement;
  copyText: string | null;
  jump: () => void;
  /** Names what the jump button does; defaults to going to the destination. */
  jumpLabel?: string;
  /** The card brings its own actions, so the popup shows no title bar. */
  bare?: boolean;
}

export function sameTarget(a: HoverTarget | null, b: HoverTarget | null): boolean {
  return a !== null && b !== null && a.group[0] === b.group[0] && a.ref?.start === b.ref?.start && a.ref?.end === b.ref?.end;
}
