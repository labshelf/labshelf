/** Parses the `.lsstate` file a full build writes: the counters and absolute page before each sectioning command. */

export interface SectionState {
  /** The sectioning command without backslash, e.g. `section`; a starred one is recorded too. */
  command: string;
  /** The 1-based number of the page being filled when the command started, counting every shipped-out page. */
  absolutePage: number;
  /** The command's line in `file`. */
  line: number;
  /** The file holding the command, as TeX names it relative to the main file's folder. */
  file: string;
  /** Every LaTeX counter's value before the command, `page` included. */
  counters: Readonly<Record<string, number>>;
}

export interface ParsedSectionStates {
  states: SectionState[];
  /** Lines that were not a full record, such as the last one of a run that crashed while writing. */
  skipped: number;
}

// CONTRACT: the line shape is written by `sectionStatePackage`: command|page|line|file|name=value name=value…
const LINE = /^([a-z]+)\|(\d+)\|(\d+)\|([^|]+)\|(.*)$/;
const COUNTER = /^([^=\s]+)=(-?\d+)$/;

function parseCounters(text: string): Record<string, number> | undefined {
  const counters: Record<string, number> = {};
  for (const pair of text.split(" ").filter((part) => part !== "")) {
    const match = COUNTER.exec(pair);
    if (!match) { return undefined; }
    counters[match[1]!] = Number(match[2]);
  }
  return counters;
}

function parseLine(line: string): SectionState | undefined {
  const match = LINE.exec(line);
  const counters = match && parseCounters(match[5]!);
  if (!match || !counters) { return undefined; }
  return { command: match[1]!, absolutePage: Number(match[2]), line: Number(match[3]), file: match[4]!, counters };
}

export function parseSectionStates(text: string): ParsedSectionStates {
  const states: SectionState[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/).filter((entry) => entry !== "")) {
    const state = parseLine(line);
    if (state) { states.push(state); } else { skipped += 1; }
  }
  return { states, skipped };
}
