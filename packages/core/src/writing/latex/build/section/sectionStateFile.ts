/** Parses the `.lsstate` file a full build writes: the counters before each sectioning command and the page it lands on. */

export interface SectionState {
  /** The sectioning command without backslash, e.g. `section`; a starred one is recorded too. */
  command: string;
  /** The 1-based number of the page the heading lands on, counting every shipped-out page. */
  absolutePage: number;
  /** The 1-based number of the page being filled when the command started, which holds the previous section's tail. */
  fillingPage: number;
  /** The command's line in `file`. */
  line: number;
  /** The file holding the command, as TeX names it relative to the main file's folder. */
  file: string;
  /** Every LaTeX counter's value before the command; `page` is the heading's page. */
  counters: Readonly<Record<string, number>>;
}

export interface ParsedSectionStates {
  states: SectionState[];
  /** Lines that were not a full record, such as the last one of a run that crashed while writing. */
  skipped: number;
}

// CONTRACT: the line shapes are written by `sectionStatePackage`: command|page|line|file|name=value name=value…, then at
// shipout P|record number|absolute page|page counter, where the record number counts command lines from 1.
const LINE = /^([a-z]+)\|(\d+)\|(\d+)\|([^|]+)\|(.*)$/;
const LANDING = /^P\|(\d+)\|(\d+)\|(-?\d+)$/;
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
  return { command: match[1]!, absolutePage: Number(match[2]), fillingPage: Number(match[2]), line: Number(match[3]), file: match[4]!, counters };
}

interface Landing { absolutePage: number; page: number }

// TRAP: the command line is written before TeX breaks the page at `\@secpenalty`, so its page is one early whenever the
// heading moves to the next page; the landing record has the real one. A heading without one (cut off at the end of a
// crashed run, or a class bypassing the hooked commands) keeps the command line's page.
export function parseSectionStates(text: string): ParsedSectionStates {
  const slots: (SectionState | undefined)[] = [];
  const landings = new Map<number, Landing>();
  let skipped = 0;
  for (const line of text.split(/\r?\n/).filter((entry) => entry !== "")) {
    if (line.startsWith("P|")) {
      const match = LANDING.exec(line);
      if (match) { landings.set(Number(match[1]), { absolutePage: Number(match[2]), page: Number(match[3]) }); } else { skipped += 1; }
      continue;
    }
    const state = parseLine(line);
    slots.push(state);
    if (!state) { skipped += 1; }
  }
  const states = slots.flatMap((state, index) => {
    if (!state) { return []; }
    const landing = landings.get(index + 1);
    return [landing ? { ...state, absolutePage: landing.absolutePage, counters: { ...state.counters, page: landing.page } } : state];
  });
  return { states, skipped };
}
