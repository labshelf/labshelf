/**
 * Records the reader's open timeline: milliseconds since page start for each milestone, plus a few measured values.
 */
import type { PerfTimeline } from "../../index.js";

export class PerfMarks {
  readonly timeline: PerfTimeline = { scriptStart: Math.round(performance.now()) };

  /**
   * Records the current time under `name`.
   */
  mark(name: string): void { this.timeline[name] = Math.round(performance.now()); }

  /**
   * Records an explicit value under `name` (e.g. a byte count, not a timestamp).
   */
  set(name: string, value: number): void { this.timeline[name] = value; }
}
