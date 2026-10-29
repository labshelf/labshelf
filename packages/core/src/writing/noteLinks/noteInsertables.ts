/** Lists the equations and outputs of the project's notes and the cited papers' notes that "Insert from note" offers, and builds the insert and update texts. */
// CONTRACT: documents/contracts/qmd-items.md#manuscript-links
import { deriveCodeHash, extractLineContent, findCodeFences, findOutputs, parseItemFile, splitLines } from "../../qmd/item/index.js";
import type { LatexRange } from "../../latex/index.js";
import { deriveOriginHash } from "./originComment.js";
import { formatOriginComment } from "./originSyntax.js";
import type { ManuscriptOrigin } from "./scanOrigins.js";
import type { OriginState } from "./originState.js";

export interface NoteInsertable { notePath: string; label: string; latex: string; source: "equation" | "output"; title: string; outOfDate?: boolean }

/** Injected readers; `readProjectNote` and `readPaperNote` give the whole item-file text, `undefined` when absent. */
export interface NoteInsertSource { listProjectNotes(): Promise<{ path: string; title: string }[]>; readProjectNote(path: string): Promise<string | undefined>; listCitedPaperIds(): Promise<string[]>; readPaperNote(paperId: string): Promise<string | undefined> }

const EQUATION = /\$\$([\s\S]+?)\$\$[ \t]*\{#(eq-[^}\s]+)[^}]*\}/g;
const DISPLAY = /\$\$([\s\S]+?)\$\$/;
const LABEL = /^#\|\s*label:\s*(\S+)\s*$/;

interface Found { position: number; build: () => Promise<NoteInsertable> }

/** Project notes first, then the cited papers' notes; within a note, in document order. */
export async function listNoteInsertables(project: NoteInsertSource): Promise<NoteInsertable[]> {
  const result: NoteInsertable[] = [];
  for (const note of await project.listProjectNotes()) {
    const text = await project.readProjectNote(note.path);
    if (text !== undefined) { result.push(...await listFromNote(text, note.path, note.title)); }
  }
  for (const paperId of await project.listCitedPaperIds()) {
    const text = await project.readPaperNote(paperId);
    if (text !== undefined) { result.push(...await listFromNote(text, `paper:${paperId}/notes.qmd`, paperNoteTitle(paperId))); }
  }
  return result;
}

function paperNoteTitle(paperId: string): string {
  return paperId;
}

async function listFromNote(text: string, notePath: string, title: string): Promise<NoteInsertable[]> {
  const bodies: { base: number; text: string }[] = [];
  let offset = 0;
  for (const segment of parseItemFile(text).segments) {
    if (segment.kind === "loose") {
      bodies.push({ base: offset, text: segment.text });
      offset += segment.text.length;
    } else {
      bodies.push({ base: offset + segment.fence.length, text: segment.body });
      offset += segment.fence.length + segment.body.length + segment.close.length;
    }
  }
  const cells = new Map<string, string>();
  const scoped = bodies.map((body) => ({ body, cells: readCells(body.text) }));
  for (const { cells: own } of scoped) { for (const [label, code] of own.labeled) { if (!cells.has(label)) { cells.set(label, code); } } }
  const found: Found[] = [];
  for (const { body, cells: own } of scoped) {
    const outputs = findOutputs(body.text);
    let masked = body.text;
    for (const output of outputs) {
      masked = masked.slice(0, output.start) + " ".repeat(output.end - output.start) + masked.slice(output.end);
    }
    for (const match of masked.matchAll(EQUATION)) {
      const latex = match[1]!.trim();
      const label = match[2]!;
      found.push({ position: body.base + match.index, build: async () => ({ notePath, label, latex, source: "equation", title }) });
    }
    for (const output of outputs) {
      const display = DISPLAY.exec(output.content);
      if (!display) { continue; }
      const latex = display[1]!.trim();
      const code = own.labeled.get(output.cell) ?? own.unlabeled.get(output.cell) ?? cells.get(output.cell);
      found.push({
        position: body.base + output.start,
        build: async () => {
          const outOfDate = code === undefined || (await deriveCodeHash(code)) !== output.source;
          return { notePath, label: output.cell, latex, source: "output", title, ...(outOfDate ? { outOfDate: true } : {}) };
        },
      });
    }
  }
  found.sort((a, b) => a.position - b.position);
  return Promise.all(found.map((entry) => entry.build()));
}

/** The code of each cell in `body`: by its `#| label:` option, or as `cell-<n>` (n-th cell, counted from 1) when it has none. Fences inside outputs are not cells. */
function readCells(body: string): { labeled: Map<string, string>; unlabeled: Map<string, string> } {
  const lines = splitLines(body);
  const outputs = findOutputs(body);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length; }
  const labeled = new Map<string, string>();
  const unlabeled = new Map<string, string>();
  let position = 0;
  for (const [open, close] of findCodeFences(lines)) {
    if (outputs.some((output) => starts[open]! >= output.start && starts[open]! < output.end)) { continue; }
    position++;
    const inner = lines.slice(open + 1, close);
    const code = inner.join("");
    const own = inner.map((line) => LABEL.exec(extractLineContent(line))?.[1]).find((value) => value !== undefined);
    if (own === undefined) { unlabeled.set(`cell-${position}`, code); } else if (!labeled.has(own)) { labeled.set(own, code); }
  }
  return { labeled, unlabeled };
}

/** The LaTeX insert with its origin comment. Rejects for an out-of-date output and for Typst. */
export async function buildInsert(item: NoteInsertable, language: "latex" | "typst"): Promise<string> {
  if (item.outOfDate) { throw new Error(`Output ${item.label} is out of date: run its cell again before inserting it`); }
  if (language === "typst") { throw new Error("Typst insert needs a LaTeX to Typst conversion, which does not exist yet"); }
  const comment = formatOriginComment("latex", { notePath: item.notePath, label: item.label, hash: await deriveOriginHash(item.latex) });
  return `\\begin{equation}\n${item.latex}\n\\label{${item.label}}\n\\end{equation} ${comment}`;
}

/** Replaces the whole inserted block only when the manuscript's text is untouched and the note changed; never overwrites a manuscript edit. */
export async function buildUpdate(origin: ManuscriptOrigin, state: OriginState, item: NoteInsertable, language: "latex" | "typst" = "latex"): Promise<{ range: LatexRange; text: string } | undefined> {
  if (state !== "stale") { return undefined; }
  return { range: origin.insertedRange, text: await buildInsert(item, language) };
}

/** The two LaTeX texts for a side-by-side view. */
export function diffOrigin(_origin: ManuscriptOrigin, manuscriptLatex: string, item: NoteInsertable): { manuscript: string; note: string } {
  return { manuscript: manuscriptLatex, note: item.latex };
}
