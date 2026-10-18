/** Writes the LaTeX package a full build loads to record, at each sectioning command, every counter and the absolute page. */

export const SECTION_STATE_PACKAGE = "labshelf-state";

/** The state file of a job; TeX writes it into the output folder, the only place `openout_any=p` allows. */
export function sectionStateFileName(jobName: string): string {
  return `${jobName}.lsstate`;
}

const COMMANDS = ["part", "chapter", "section", "subsection", "subsubsection"];

// INVARIANT: `\immediate\write` adds no node, so the record cannot change the spacing or page breaks around a heading.
// PLATFORM: `\AddToHook`, `\ReadonlyShipoutCounter` and `\CurrentFile` need LaTeX 2020-10; an older kernel loads nothing.
export function sectionStatePackage(): string {
  return [
    "\\NeedsTeXFormat{LaTeX2e}",
    `\\ProvidesPackage{${SECTION_STATE_PACKAGE}}[LabShelf section state]`,
    "\\ifdefined\\ReadonlyShipoutCounter\\else\\expandafter\\endinput\\fi",
    "\\newwrite\\labshelf@state",
    "\\immediate\\openout\\labshelf@state=\\jobname.lsstate\\relax",
    "\\def\\labshelf@counter#1{ #1=\\the\\csname c@#1\\endcsname}",
    "\\def\\labshelf@file{\\ifx\\CurrentFilePath\\@empty\\else\\CurrentFilePath/\\fi\\CurrentFile}",
    "\\def\\labshelf@record#1{{\\let\\@elt\\labshelf@counter\\immediate\\write\\labshelf@state"
      + "{#1|\\the\\numexpr\\ReadonlyShipoutCounter+1\\relax|\\the\\inputlineno|\\labshelf@file|\\cl@@ckpt}}}",
    ...COMMANDS.map((command) => `\\AddToHook{cmd/${command}/before}{\\labshelf@record{${command}}}`),
    "",
  ].join("\n");
}
