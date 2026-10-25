// Orders a build's problems and preprint entries into the list the PDF preview marks, placed ones in reading order first.
import type { PageArea, PdfProblem, PdfProblemKind } from "../../reader/index.js";
import type { LocatedProblem } from "../../latex/index.js";

interface ProblemPlace {
  kind: PdfProblemKind;
  subject?: string;
  file?: string;
  line?: number;
}

export interface OrderPdfProblemsInput {
  build: readonly LocatedProblem[];
  preprints: readonly { key: string; message: string; file?: string; line?: number }[];
  /** Finds where the PDF shows the problem; called once per distinct problem. */
  place(problem: ProblemPlace): PageArea | undefined;
}

const byReading = (a: PageArea, b: PageArea): number => a.page - b.page || a.top - b.top || a.left - b.left;

const byFile = (a: PdfProblem, b: PdfProblem): number => {
  if ((a.file === undefined) !== (b.file === undefined)) return a.file === undefined ? 1 : -1;
  const files = (a.file ?? "").localeCompare(b.file ?? "");
  if (files !== 0) return files;
  if ((a.line === undefined) !== (b.line === undefined)) return a.line === undefined ? 1 : -1;
  return (a.line ?? 0) - (b.line ?? 0);
};

export function orderPdfProblems(input: OrderPdfProblemsInput): PdfProblem[] {
  const candidates: PdfProblem[] = [];
  for (const p of input.build) {
    if (p.kind === undefined) continue;
    candidates.push(compact({ kind: p.kind, subject: p.subject, message: p.message, file: p.file, line: p.line }));
  }
  for (const p of input.preprints) {
    candidates.push(compact({ kind: "preprint", subject: p.key, message: p.message, file: p.file, line: p.line }));
  }

  const seen = new Set<string>();
  const placed: PdfProblem[] = [];
  const unplaced: PdfProblem[] = [];
  for (const candidate of candidates) {
    const id = JSON.stringify([candidate.kind, candidate.subject, candidate.file, candidate.line]);
    if (seen.has(id)) continue;
    seen.add(id);
    const area = input.place(candidate);
    (area ? placed : unplaced).push(area ? { ...candidate, area } : candidate);
  }
  placed.sort((a, b) => byReading(a.area as PageArea, b.area as PageArea));
  unplaced.sort(byFile);
  return [...placed, ...unplaced];
}

// PdfProblem forbids explicit undefined properties, and the sources carry optional fields.
function compact(problem: { [K in keyof PdfProblem]?: PdfProblem[K] | undefined }): PdfProblem {
  return Object.fromEntries(Object.entries(problem).filter(([, v]) => v !== undefined)) as unknown as PdfProblem;
}
