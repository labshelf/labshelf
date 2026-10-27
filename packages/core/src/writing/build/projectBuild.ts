// Runtime-neutral parts of building a writing project: when it compiles, how the host is asked about TeX, how a build ends, where the built and preview PDFs live and how its problems are ordered for the PDF preview.
import type { PathOps } from "../../path/index.js";
import type { PageArea, PdfProblem, PdfProblemKind } from "../../reader/index.js";
import type { LatexBuildResult, LocatedProblem, TexInstallKind } from "../../latex/index.js";
import type { TypstBuildResult } from "../../typst/index.js";
import type { ProjectEntry } from "../project/index.js";
import { deriveBuildRootFolder } from "../project/buildRoot.js";
import type { ProjectContentPort } from "../project/index.js";

// --- The TeX setup prompt ---

// The managed TeX install cannot be cancelled once it starts, so progress carries no abort signal.
export interface TexSetupAsk {
  /** Asks which LaTeX to install when none is found; undefined declines. */
  chooseInstall(): Promise<TexInstallKind | undefined>;
  /** Runs long TeX work (an install, a package) with visible progress. */
  progress<T>(title: string, run: (report: (message: string) => void) => Promise<T>): Promise<T>;
}

// --- When a project compiles ---

export const AUTO_COMPILE_MODES = ["typing", "save", "off"] as const;
export type BuildSchedule = (typeof AUTO_COMPILE_MODES)[number];

/** Apps save a source this long after the last keystroke while the mode is "typing", so each pause compiles. */
export const AUTO_SAVE_DELAY_MS = 300;

const LABELS: Record<BuildSchedule, string> = {
  typing: "Auto compile",
  save: "Compile on save",
  off: "Compile manually",
};

export function formatAutoCompileLabel(mode: BuildSchedule): string {
  return LABELS[mode];
}

// --- How a build ends ---

export type ProjectBuildResult =
  | LatexBuildResult
  | TypstBuildResult
  | { status: "no-main" }
  | { status: "toolchain-missing"; reason: "declined" }
  | { status: "toolchain-missing"; reason: "install-failed"; message: string };

export type ToolchainMissing = Extract<ProjectBuildResult, { status: "toolchain-missing" }>;

// --- Where the PDFs live ---

/** `root` is project-relative with "/" separators; undefined when the project has no root to build. */
export function deriveBuiltPdfPath(paths: Pick<PathOps, "join">, project: Extract<ProjectEntry, { kind: "ready" }>, root: string | undefined = project.main): string | undefined {
  if (!root) { return undefined; }
  const slash = root.lastIndexOf("/");
  const file = root.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  return paths.join(project.folder, root.slice(0, Math.max(slash, 0)), `${dot > 0 ? file.slice(0, dot) : file}.pdf`);
}

/** Names the PDF a Typst root's live preview shows, kept in the root's build folder apart from the saved <root>.pdf; `root` is the compiled file relative to the project folder. */
export function buildTypstPreviewPdf(
  project: Extract<ProjectEntry, { kind: "ready" }>,
  root: string,
  data: Pick<ProjectContentPort, "projectBuildDir">,
  paths: Pick<PathOps, "join" | "basename" | "extname">,
): string {
  const folder = paths.join(data.projectBuildDir(project.settings.id), deriveBuildRootFolder(root));
  return paths.join(folder, `${paths.basename(root, paths.extname(root))}.pdf`);
}

// --- The PDF preview's problem list ---

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
