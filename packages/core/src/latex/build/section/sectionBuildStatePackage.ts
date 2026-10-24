/** Writes the LaTeX package a full build loads to record, at each sectioning command, every counter, and the page each heading lands on. */

export const SECTION_STATE_PACKAGE = "labshelf-state";

/** The state file of a job; TeX writes it into the output folder, the only place `openout_any=p` allows. */
export function sectionStateFileName(jobName: string): string {
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
export function sectionStatePackage(): string {
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
