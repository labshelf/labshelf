// Decides what the Details surface shows: each source keeps its last selection, and the last one published or activated wins.
import type { DetailsTarget } from "./protocol/index.js";

export interface SelectionHub {
  /** Stores the source's target and shows it. */
  publish(source: string, target: DetailsTarget): void;
  /** Shows the source's stored target; does nothing when the source has published none. */
  activate(source: string): void;
  /** The last target shown, so a Details surface mounted late can catch up. */
  current(): DetailsTarget;
}

/** `show` receives every target the hub decides to show. Sources are names the app chooses. */
export function createSelectionHub(show: (target: DetailsTarget) => void): SelectionHub {
  const bySource = new Map<string, DetailsTarget>();
  let shown: DetailsTarget = null;
  const display = (target: DetailsTarget): void => { shown = target; show(target); };
  return {
    publish(source, target) { bySource.set(source, target); display(target); },
    activate(source) { if (bySource.has(source)) display(bySource.get(source)!); },
    current: () => shown,
  };
}
