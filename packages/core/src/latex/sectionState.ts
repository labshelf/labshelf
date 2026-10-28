/** Captures a section's state in a full build: the package that records every counter and page, the file it writes, its parser, and the TeX that restores a section's counters. */

export interface SectionState {
  /** The sectioning command without backslash, e.g. `section`; a starred one is recorded too. */
  command: string;
  /** True only when the full build records an empty page with no pending floats. */
  pageBoundary?: boolean;
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

// CONTRACT: documents/contracts/helper.md#messages
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
export function parseSectionBuildStates(text: string): ParsedSectionStates {
  const slots: (SectionState | undefined)[] = [];
  const landings = new Map<number, Landing>();
  const boundaries = new Set<number>();
  let skipped = 0;
  for (const line of text.split(/\r?\n/).filter((entry) => entry !== "")) {
    if (line.startsWith("B|")) {
      const match = /^B\|(\d+)$/.exec(line);
      if (match) boundaries.add(Number(match[1])); else skipped += 1;
      continue;
    }
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
    if (landing && boundaries.has(index + 1)) state.pageBoundary = true;
    return [landing ? { ...state, absolutePage: landing.absolutePage, counters: { ...state.counters, page: landing.page } } : state];
  });
  return { states, skipped };
}

export const SECTION_STATE_PACKAGE = "labshelf-state";

/** The state file of a job; TeX writes it into the output folder, the only place `openout_any=p` allows. */
export function deriveSectionBuildStateFileName(jobName: string): string {
  return `${jobName}.lsstate`;
}

const COMMANDS = ["part", "chapter", "section", "subsection", "subsubsection"];

const LANDING_COMMANDS = ["@part", "@spart", "@chapter", "@schapter"];

// A mid-page heading or pending float cannot be reproduced by restoring counters alone.
function boundaryRecord(): string {
  const conditions = ["\\ifvmode", "\\ifinner\\else", "\\if@twocolumn\\else", "\\ifdim\\pagetotal=\\z@",
    ...["@deferlist", "@dbldeferlist", "@toplist", "@botlist", "@dbltoplist"].map((name) => `\\ifx\\${name}\\@empty`)];
  return "\\def\\labshelf@boundary{" + conditions.join("")
    + "\\immediate\\write\\labshelf@state{B|\\the\\labshelf@index}" + "\\fi".repeat(conditions.length) + "}";
}

// INVARIANT: `\immediate\write` adds no node, so the counters record cannot change the spacing or page breaks around a heading.
// The landing record is a delayed `\write`, expanded at shipout, so it names the page the heading actually lands on rather than
// the page being filled before the heading's `\@secpenalty` break. Its whatsit sits beside LaTeX's own `\addcontentsline` one
// (after the heading box, before `\nobreak\vskip`; inside a run-in heading; at the start of `\@part`/`\@chapter`), so it adds
// no breakpoint and leaves `\lastskip` alone. A class that bypasses `\@xsect`, `\@part` and `\@chapter` writes no landing record.
// PLATFORM: `\AddToHook`, `\ReadonlyShipoutCounter` and `\CurrentFile` need LaTeX 2020-10; an older kernel loads nothing.
// PLATFORM: `cmd/section/after` cannot be used: it lands before `\@startsection`'s `\@ifstar` and breaks every heading.
export function createSectionBuildStatePackage(): string {
  return [
    "\\NeedsTeXFormat{LaTeX2e}",
    `\\ProvidesPackage{${SECTION_STATE_PACKAGE}}[LabShelf section state]`,
    "\\ifdefined\\ReadonlyShipoutCounter\\else\\expandafter\\endinput\\fi",
    "\\newwrite\\labshelf@state",
    "\\immediate\\openout\\labshelf@state=\\jobname.lsstate\\relax",
    "\\newcount\\labshelf@index",
    "\\let\\labshelf@pending\\relax",
    boundaryRecord(),
    "\\def\\labshelf@counter#1{ #1=\\the\\csname c@#1\\endcsname}",
    "\\def\\labshelf@file{\\ifx\\CurrentFilePath\\@empty\\else\\CurrentFilePath/\\fi\\CurrentFile}",
    "\\def\\labshelf@record#1{{\\let\\@elt\\labshelf@counter\\immediate\\write\\labshelf@state"
      + "{#1|\\the\\numexpr\\ReadonlyShipoutCounter+1\\relax|\\the\\inputlineno|\\labshelf@file|\\cl@@ckpt}}"
      + "\\global\\advance\\labshelf@index\\@ne\\labshelf@boundary"
      + "\\xdef\\labshelf@pending{\\write\\labshelf@state"
      + "{P|\\the\\labshelf@index|\\noexpand\\the\\noexpand\\ReadonlyShipoutCounter|\\noexpand\\the\\noexpand\\c@page}}}",
    "\\def\\labshelf@land{\\labshelf@pending\\global\\let\\labshelf@pending\\relax}",
    "\\def\\labshelf@landsection{\\ifdim\\@tempskipa>\\z@\\labshelf@land"
      + "\\else\\expandafter\\def\\expandafter\\@svsechd\\expandafter{\\@svsechd\\labshelf@land}\\fi}",
    "\\AddToHook{cmd/@xsect/before}{\\labshelf@landsection}",
    ...LANDING_COMMANDS.map((command) => `\\AddToHook{cmd/${command}/before}{\\labshelf@land}`),
    ...COMMANDS.map((command) => `\\AddToHook{cmd/${command}/before}{\\labshelf@record{${command}}}`),
    "",
  ].join("\n");
}

/** A counter the section's own document never defines, e.g. one a later `\newcounter` creates, is skipped instead of failing. */
export function createSectionBuildStateRestore(state: SectionState): string {
  return Object.entries(state.counters)
    .map(([name, value]) => `\\ifcsname c@${name}\\endcsname\\setcounter{${name}}{${value}}\\fi\n`)
    .join("");
}
