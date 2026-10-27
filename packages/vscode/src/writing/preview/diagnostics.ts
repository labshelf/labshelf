// Tells the preview what is wrong with a built root: its problems placed on the PDF, and whether its PDF is older than the sources.
import {
  findCiteKeyOccurrences, orderPdfProblems, findPagePoint, isInside,
  type ILogger, type LocatedProblem, type PageArea, type PagePoint, type PathOps, type PdfProblem, type SynctexMap, type TypstCitation,
} from "@labshelf/core";
import { deriveProjectPath, type ReadyProject } from "../commands/index.js";
import { PREVIEW_LOG_MODULE } from "./panel.js";
import type { SynctexFinder } from "./synctex.js";

export interface PdfProblemsDeps {
  logger: ILogger;
  paths: PathOps;
  problemsOf: (root: string) => readonly LocatedProblem[];
  preprints: (project: ReadyProject) => Promise<{ key: string; message: string; file?: string; line?: number }[]>;
  synctex: () => Promise<SynctexFinder>;
  typstCites: () => readonly TypstCitation[];
  readSources: (project: ReadyProject, root: string) => Promise<{ file: string; text: string }[]>;
}

const atPoint = ({ page, x, y }: PagePoint): PageArea => ({ page, left: x, right: x, top: y, bottom: y });

/** The SyncTeX index of the root's build; a build without usable data places nothing and the reason is logged once. */
async function syncIndexOf(deps: PdfProblemsDeps, folder: string, root: string): Promise<SynctexMap | undefined> {
  try {
    const lookup = await deps.synctex();
    if (lookup.status === "found") { return lookup.index; }
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Problems stay unplaced without SyncTeX data", { projectFolder: folder, root, reason: lookup.status });
  } catch (error) {
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: folder, root });
  }
  return undefined;
}

type Place = Parameters<typeof orderPdfProblems>[0]["place"];

function latexPlace(deps: PdfProblemsDeps, folder: string, index: SynctexMap | undefined): Place {
  return ({ file, line }) => {
    if (!index || file === undefined || line === undefined) { return undefined; }
    const point = findPagePoint(index, deps.paths.join(folder, file), line);
    return point && atPoint(point);
  };
}

// Typst reports no source line for a PDF position, so only a citation, found by its key, has a place (D8).
function typstPlace(cites: readonly TypstCitation[]): Place {
  return ({ kind, subject }) => {
    if (kind !== "undefinedCitation" && kind !== "preprint") { return undefined; }
    const cite = cites.find((candidate) => candidate.key === subject);
    return cite && atPoint(cite.at);
  };
}

async function citeCount(deps: PdfProblemsDeps, project: ReadyProject, root: string): Promise<number> {
  const keys = new Set<string>();
  for (const { text } of await deps.readSources(project, root)) {
    for (const { key } of findCiteKeyOccurrences(project.settings.format, text)) { keys.add(key); }
  }
  return keys.size;
}

export async function readPdfProblems(deps: PdfProblemsDeps, project: ReadyProject, root: string): Promise<{ pdfProblems: PdfProblem[]; cites: number }> {
  const build = deps.problemsOf(root).map((problem) => ({ ...problem, file: deriveProjectPath(deps.paths, project.folder, problem.file) }));
  const preprints = (await deps.preprints(project)).map((entry) => (
    entry.file === undefined ? entry : { ...entry, file: deriveProjectPath(deps.paths, project.folder, entry.file) }
  ));
  const typst = project.settings.format === "typst";
  const index = typst || build.length + preprints.length === 0 ? undefined : await syncIndexOf(deps, project.folder, root);
  const place = typst ? typstPlace(deps.typstCites()) : latexPlace(deps, project.folder, index);
  return { pdfProblems: orderPdfProblems({ build, preprints, place }), cites: await citeCount(deps, project, root) };
}

export interface SourceEvents {
  onSourceChanged(listener: (filePath: string) => void): { dispose(): void };
}

export interface StaleSourcesState {
  stale?: boolean;
  builtAt?: number;
}

interface RootRecord {
  builtAt?: number;
  stale: boolean;
  // INVARIANT: set when a source changes while a build runs, so that build's success cannot clear the change.
  changedSinceStart: boolean;
}

// Built outputs (.log, .aux, .pdf) are not sources: a build writes them and must not mark itself stale.
const SOURCE_EXTENSIONS = new Set([".tex", ".typ", ".bib", ".sty", ".cls"]);

export class StaleSources {
  private readonly roots = new Map<string, Map<string, RootRecord>>();
  private readonly subscription: { dispose(): void };

  /** `onStale` fires once when a built root turns stale, not on every later change. */
  constructor(private readonly paths: PathOps, events: SourceEvents, private readonly now: () => number, private readonly onStale: (folder: string, root: string) => void) {
    this.subscription = events.onSourceChanged((filePath) => this.changed(filePath));
  }

  building(folder: string, root: string): void {
    this.record(folder, root).changedSinceStart = false;
  }

  succeeded(folder: string, root: string): void {
    const record = this.record(folder, root);
    record.builtAt = this.now();
    record.stale = record.changedSinceStart;
    record.changedSinceStart = false;
  }

  failed(folder: string, root: string): void {
    this.record(folder, root).changedSinceStart = false;
  }

  statusOf(folder: string, root: string): StaleSourcesState {
    const record = this.roots.get(folder)?.get(root);
    return record?.builtAt === undefined ? {} : { stale: record.stale, builtAt: record.builtAt };
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private record(folder: string, root: string): RootRecord {
    const records = this.roots.get(folder) ?? new Map<string, RootRecord>();
    this.roots.set(folder, records);
    const record = records.get(root) ?? { stale: false, changedSinceStart: false };
    records.set(root, record);
    return record;
  }

  private changed(filePath: string): void {
    if (!SOURCE_EXTENSIONS.has(this.paths.extname(filePath))) { return; }
    for (const [folder, records] of this.roots) {
      if (!isInside(this.paths, folder, filePath)) { continue; }
      for (const [root, record] of records) {
        record.changedSinceStart = true;
        if (record.builtAt === undefined || record.stale) { continue; }
        record.stale = true;
        this.onStale(folder, root);
      }
    }
  }
}
