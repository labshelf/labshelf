/** The page map of a full build: the package that records which source unit shipped each page and where each poster block sits, the file it writes, and its parser. */

export type DeckPageUnitKind = "frame" | "section" | "block";

/** `file` is as `\CurrentFile` gives it, relative to the build's working folder (the main file's folder), with "/" separators. */
export interface DeckPageUnit { file: string; line: number; kind: DeckPageUnitKind }

/** `rect` is in PDF points from the page's top-left corner; `page` is 1-based. */
export interface DeckPageBlock { file: string; line: number; page: number; rect: { left: number; top: number; right: number; bottom: number } }

/** `pages[i]` is the unit that shipped page i+1, or null when no unit was open. */
export interface DeckPageMap { pages: Array<DeckPageUnit | null>; blocks: DeckPageBlock[] }

export const PAGE_MARKS_PACKAGE = "labshelf-marks";

/** The page map of a job; TeX writes it into the output folder, the only place `openout_any=p` allows. */
export function derivePageMarksFileName(jobName: string): string {
  return `${jobName}.lsmap`;
}

// CONTRACT: the sidecar has one record per line, the file always last so it may hold "|":
//   U|<page>|<kind>|<line>|<file>  or  U|<page>|-     the unit open when page <page> shipped
//   K|<id>|<ordinal>|<width sp>|<line>|<file>         a block opened; ordinal 0: the line is the block's own,
//                                                     n > 0: the line is its frame's and the block is the frame's n-th
//   Q|<id>|<page>|<x sp>|<y sp>|<page height sp>      a point of the block, from the page's bottom-left
const UNIT = /^U\|(\d+)\|(?:-|(frame|section|block)\|(\d+)\|(.+))$/;
const BLOCK = /^K\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(.+)$/;
const POINT = /^Q\|(\d+)\|(\d+)\|(-?\d+)\|(-?\d+)\|(\d+)$/;

interface BlockMark { ordinal: number; width: number; line: number; file: string }
interface Point { x: number; y: number; height: number }

// PLATFORM: savepos positions are in scaled TeX points (1/65536 pt, 72.27 pt per inch); PDF points are 72 per inch.
const PDF_POINTS_PER_SP = 72 / 72.27 / 65536;

function blockRect(points: Point[], width: number): DeckPageBlock["rect"] | undefined {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const height = points[0]!.height;
  const left = Math.min(...xs);
  const right = Math.max(...xs, points[0]!.x + width);
  const rect = { left: left * PDF_POINTS_PER_SP, top: (height - Math.max(...ys)) * PDF_POINTS_PER_SP, right: right * PDF_POINTS_PER_SP, bottom: (height - Math.min(...ys)) * PDF_POINTS_PER_SP };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : undefined;
}

/** Lines that are not a full record, such as the last one of a crashed run, are skipped; so are blocks whose line is still their frame's. */
export function parseDeckPageMap(text: string): DeckPageMap {
  const units = new Map<number, DeckPageUnit | null>();
  const marks = new Map<number, BlockMark>();
  const points = new Map<string, Point[]>();
  for (const line of text.split(/\r?\n/)) {
    const unit = UNIT.exec(line);
    if (unit) {
      units.set(Number(unit[1]), unit[2] ? { file: unit[4]!, line: Number(unit[3]), kind: unit[2] as DeckPageUnitKind } : null);
      continue;
    }
    const block = BLOCK.exec(line);
    if (block) {
      marks.set(Number(block[1]), { ordinal: Number(block[2]), width: Number(block[3]), line: Number(block[4]), file: block[5]! });
      continue;
    }
    const point = POINT.exec(line);
    if (!point) { continue; }
    const key = `${point[1]}|${point[2]}`;
    points.set(key, [...(points.get(key) ?? []), { x: Number(point[3]), y: Number(point[4]), height: Number(point[5]) }]);
  }
  const pageCount = Math.max(0, ...units.keys());
  const pages = Array.from({ length: pageCount }, (_, index) => units.get(index + 1) ?? null);
  const blocks = [...points].flatMap(([key, pagePoints]) => {
    const [id, page] = key.split("|").map(Number) as [number, number];
    const mark = marks.get(id);
    const rect = mark && mark.ordinal === 0 ? blockRect(pagePoints, mark.width) : undefined;
    return mark && rect ? [{ file: mark.file, line: mark.line, page, rect }] : [];
  });
  blocks.sort((a, b) => a.page - b.page || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  return { pages, blocks };
}

/** The files holding frames whose blocks must be placed by `placeFramedBlocks` before parsing. */
export function listFramedBlockFiles(text: string): string[] {
  const files = text.split(/\r?\n/).flatMap((line) => {
    const block = BLOCK.exec(line);
    return block && block[2] !== "0" ? [block[5]!] : [];
  });
  return [...new Set(files)];
}

const FRAME_TOKEN = /\\(begin|end)\{(frame|block|alertblock|exampleblock)\}/g;

/** The 1-based line of the `ordinal`-th block `\begin` inside the frame that begins on `frameLine`; comments are not read. */
function findFramedBlockLine(source: string, frameLine: number, ordinal: number): number | undefined {
  const lines = source.split(/\r?\n/);
  let inFrame = false;
  let count = 0;
  for (let index = frameLine - 1; index < lines.length; index += 1) {
    const code = lines[index]!.replace(/(^|[^\\])%.*$/, "$1");
    for (const [, verb, name] of code.matchAll(FRAME_TOKEN)) {
      if (name === "frame") {
        if (inFrame && verb === "end") { return undefined; }
        inFrame ||= verb === "begin";
      } else if (inFrame && verb === "begin" && ++count === ordinal) {
        return index + 1;
      }
    }
  }
  return undefined;
}

// TRAP: beamer collects a frame's body before typesetting it, so `\inputlineno` inside the body is the `\end{frame}` line.
// The package records a block inside a frame by its frame's line and its order in the frame's pass; its own line is
// found here in the frame's source. A block a macro or `\only` hides from the source count keeps no line and is dropped.
/** Rewrites each framed block record to its own line; `sources` maps a record's file to its text. */
export function placeFramedBlocks(text: string, sources: ReadonlyMap<string, string>): string {
  return text.split(/\r?\n/).map((line) => {
    const block = BLOCK.exec(line);
    if (!block || block[2] === "0") { return line; }
    const source = sources.get(block[5]!);
    const own = source === undefined ? undefined : findFramedBlockLine(source, Number(block[4]), Number(block[2]));
    return own === undefined ? line : `K|${block[1]}|0|${block[3]}|${own}|${block[5]}`;
  }).join("\n");
}

const BEAMER_BLOCKS = ["block", "alertblock", "exampleblock"];

// PLATFORM: XeTeX's driver moves PGF boxes with specials that savepos cannot see, so the point is saved at the canvas origin
// and the anchor's canvas offset is added at shipout; `\pgftext` keeps every TikZ style from drawing the mark.
const CORNERS = "\\def\\lsmarks@corner#1#2#3{\\pgfscope\\pgftransformreset\\pgfpointanchor{#2}{#3}"
  + "\\edef\\lsmarks@tmp{\\noexpand\\lsmarks@pointat{#1}{\\number\\pgf@x}{\\number\\pgf@y}}\\pgftext[left,base]{\\lsmarks@tmp}\\endpgfscope}"
  + "\\def\\lsmarks@corners#1#2#3{\\lsmarks@corner{#1}{#2}{north west}\\lsmarks@corner{#1}{#3}{south east}}";

/** Wraps a `\newcommand` with an optional argument and two mandatory ones: `before` runs when it is called, `after` once it is done. */
function wrapCommand(name: string, before: string, after: string): string {
  const inner = `\\csname\\string\\${name}\\endcsname`;
  return `\\ifcsname\\string\\${name}\\endcsname`
    + `\\expandafter\\let\\csname lsmarks@inner@${name}\\expandafter\\endcsname${inner}`
    + `\\expandafter\\def${inner}[#1]#2#3{\\csname lsmarks@inner@${name}\\endcsname[{#1}]{#2}{#3}${after}}`
    + `\\expandafter\\let\\csname lsmarks@outer@${name}\\endcsname\\${name}`
    + `\\def\\${name}{${before}\\csname lsmarks@outer@${name}\\endcsname}\\fi`;
}

// INVARIANT: the package never changes what is typeset. Units and block lines are `\immediate\write`s, which add no node; a
// block's points are a savepos whatsit and a delayed `\write`, expanded at shipout once the position is known. A beamer block's
// end point goes before the glue that ends it, so `\lastskip` and every `\addvspace` after it stay the same.
// PLATFORM: hooks, `\ReadonlyShipoutCounter` and `\CurrentFile` need LaTeX 2020-10; an older kernel loads nothing. pdfTeX and
// XeTeX have `\pdfsavepos`, LuaTeX `\savepos`; without either, blocks have no box. Every class hook is guarded, so a document
// without beamer, tikzposter, tcbposter or baposter compiles as before.
// PLATFORM: `cmd/section/after` cannot be used: it lands before `\@startsection`'s `\@ifstar` and breaks every heading.
export function createPageMarksPackage(): string {
  return [...pageMarkUnits(), ...pageMarkPositions(), ...pageMarkBlocks(), ...pageMarkClasses()].join("\n");
}

/** The package header, the output file and the unit marks: sections and frames. */
function pageMarkUnits(): string[] {
  return [
    "\\NeedsTeXFormat{LaTeX2e}",
    `\\ProvidesPackage{${PAGE_MARKS_PACKAGE}}[LabShelf page marks]`,
    "\\ifdefined\\ReadonlyShipoutCounter\\else\\expandafter\\endinput\\fi",
    "\\newwrite\\lsmarks@out",
    "\\immediate\\openout\\lsmarks@out=\\jobname.lsmap\\relax",
    "\\newcount\\lsmarks@id",
    "\\newcount\\lsmarks@ordinal",
    // PLATFORM: beamer's `\ifbeamer@inframe` is true while a frame's body is typeset; other classes have no frames.
    // TRAP: the conditional is named through `\\csname`, so skipped text never meets a bare `\\if...` token and miscounts.
    "\\def\\lsmarks@inframe{\\csname if\\ifcsname ifbeamer@inframe\\endcsname beamer@inframe\\else false\\fi\\endcsname}",
    "\\newif\\iflsmarks@beamer",
    "\\gdef\\lsmarks@unit{-}\\gdef\\lsmarks@divider{}\\gdef\\lsmarks@pending{}\\gdef\\lsmarks@stack{}\\let\\lsmarks@slide\\relax",
    "\\def\\lsmarks@file{\\ifx\\CurrentFilePath\\@empty\\else\\CurrentFilePath/\\fi\\CurrentFile}",
    "\\def\\lsmarks@here{\\ifx\\lsmarks@pending\\@empty\\the\\inputlineno|\\lsmarks@file\\else\\lsmarks@pending\\fi}",
    "\\def\\lsmarks@open#1{\\xdef\\lsmarks@unit{#1|\\lsmarks@here}}",
    "\\AddToHook{shipout/before}{\\immediate\\write\\lsmarks@out{U|\\the\\numexpr\\ReadonlyShipoutCounter+1\\relax|\\lsmarks@unit}}",
    // A theme's divider frame starts on its `\section` line; any other frame opens a unit, and a section inside a frame opens none.
    "\\def\\lsmarks@section{\\lsmarks@inframe\\else\\lsmarks@open{section}\\xdef\\lsmarks@divider{\\lsmarks@here}\\fi}",
    "\\AddToHook{cmd/section/before}{\\lsmarks@section}",
    "\\AddToHook{cmd/subsection/before}{\\lsmarks@section}",
    "\\def\\lsmarks@frame{\\edef\\lsmarks@tmp{\\lsmarks@here}\\ifx\\lsmarks@tmp\\lsmarks@divider\\else\\lsmarks@open{frame}"
      + "\\global\\let\\lsmarks@divider\\@empty\\global\\let\\lsmarks@frameat\\lsmarks@tmp\\fi"
      + "\\global\\lsmarks@ordinal\\z@\\global\\let\\lsmarks@slide\\relax}",
    "\\AddToHook{env/frame/begin}{\\lsmarks@frame}",
  ];
}

/** The page height and the saved positions of a point. */
function pageMarkPositions(): string[] {
  return [
    "\\ifdefined\\pdfsavepos\\let\\lsmarks@savepos\\pdfsavepos\\def\\lsmarks@x{\\the\\pdflastxpos}\\def\\lsmarks@y{\\the\\pdflastypos}"
      + "\\else\\ifdefined\\savepos\\let\\lsmarks@savepos\\savepos\\def\\lsmarks@x{\\the\\lastxpos}\\def\\lsmarks@y{\\the\\lastypos}"
      + "\\else\\let\\lsmarks@savepos\\relax\\fi\\fi",
    "\\ifdefined\\pdfpageheight\\let\\lsmarks@pageheight\\pdfpageheight\\else\\ifdefined\\pageheight\\let\\lsmarks@pageheight\\pageheight"
      + "\\else\\let\\lsmarks@pageheight\\paperheight\\fi\\fi",
    "\\def\\lsmarks@height{\\ifdim\\lsmarks@pageheight>\\z@\\number\\lsmarks@pageheight\\else\\number\\paperheight\\fi}",
    "\\def\\lsmarks@pointat#1#2#3{\\ifx\\lsmarks@savepos\\relax\\else\\lsmarks@savepos\\edef\\lsmarks@tmp{\\write\\lsmarks@out{Q|#1|"
      + "\\noexpand\\the\\ReadonlyShipoutCounter|\\noexpand\\the\\numexpr\\noexpand\\lsmarks@x+#2\\relax|\\noexpand\\the\\numexpr\\noexpand\\lsmarks@y+#3\\relax"
      + "|\\noexpand\\lsmarks@height}}\\lsmarks@tmp\\fi}",
    "\\def\\lsmarks@point#1{\\lsmarks@pointat{#1}00}",
  ];
}

/** The block marks, and the beamer blocks that nest them. */
function pageMarkBlocks(): string[] {
  return [
    // A block inside a beamer frame counts its place in the frame's pass; each overlay is a new pass.
    "\\def\\lsmarks@pass{\\ifdefined\\beamer@slideinframe\\edef\\lsmarks@tmp{\\the\\beamer@slideinframe}"
      + "\\ifx\\lsmarks@tmp\\lsmarks@slide\\else\\global\\lsmarks@ordinal\\z@\\global\\let\\lsmarks@slide\\lsmarks@tmp\\fi\\fi}",
    "\\def\\lsmarks@block#1{\\global\\advance\\lsmarks@id\\@ne\\lsmarks@inframe\\lsmarks@pass\\global\\advance\\lsmarks@ordinal\\@ne"
      + "\\immediate\\write\\lsmarks@out{K|\\the\\lsmarks@id|\\the\\lsmarks@ordinal|#1|\\lsmarks@frameat}"
      + "\\else\\lsmarks@open{block}\\immediate\\write\\lsmarks@out{K|\\the\\lsmarks@id|0|#1|\\lsmarks@here}\\fi\\gdef\\lsmarks@pending{}}",
    "\\def\\lsmarks@vbegin{\\ifhmode\\par\\fi\\lsmarks@block{\\number\\linewidth}\\xdef\\lsmarks@stack{\\the\\lsmarks@id,\\lsmarks@stack}"
      + "\\ifvmode\\lsmarks@point{\\the\\lsmarks@id}\\fi}",
    "\\def\\lsmarks@pop#1,#2\\@nil{\\gdef\\lsmarks@stack{#2}\\ifvmode\\skip@\\lastskip\\vskip-\\skip@\\lsmarks@point{#1}\\vskip\\skip@\\fi}",
    "\\def\\lsmarks@vend{\\ifx\\lsmarks@stack\\@empty\\else\\expandafter\\lsmarks@pop\\lsmarks@stack\\@nil\\fi}",
    ...BEAMER_BLOCKS.flatMap((name) => [
      `\\AddToHook{env/${name}/begin}{\\iflsmarks@beamer\\lsmarks@vbegin\\fi}`,
      `\\AddToHook{env/${name}/after}{\\iflsmarks@beamer\\lsmarks@vend\\fi}`,
    ]),
  ];
}

/** The poster classes' hooks, set at the start of the document, and the final empty line. */
function pageMarkClasses(): string[] {
  return [
    "\\AddToHook{env/posterboxenv/begin}{\\xdef\\lsmarks@pending{\\lsmarks@here}}",
    CORNERS,
    "\\AtBeginDocument{",
    "\\@ifclassloaded{beamer}{\\lsmarks@beamertrue}{}",
    "\\@ifclassloaded{tikzposter}{"
      + wrapCommand("block", "\\lsmarks@block{0}", "\\lsmarks@corners{\\the\\lsmarks@id}{blocktitle}{blockbody}\\lsmarks@corners{\\the\\lsmarks@id}{blockbody}{blocktitle}")
      + "}{}",
    wrapCommand("tcb@poster@box", "\\lsmarks@block{0}", "\\lsmarks@corners{\\the\\lsmarks@id}{\\tikz@last@fig@name}{\\tikz@last@fig@name}"),
    "\\@ifclassloaded{baposter}{\\let\\lsmarks@headerbox\\headerbox\\def\\headerbox{\\lsmarks@block{0}\\lsmarks@headerbox}}{}",
    "}",
    "",
  ];
}
