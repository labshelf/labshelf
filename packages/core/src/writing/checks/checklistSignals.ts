/** Reads and edits a project's Checklist through the file-system port: the open-item signals of its sources and the hand-added items in .labshelf/checklist.json. */
import { readFigureBuildStates } from "../figures/index.js";
import { readLatexProjectTexts, findUndefinedReferences } from "../../latex/index.js";
import { readOptionalText, type ProjectEntry, type ProjectReadContext } from "../project/index.js";
import {
  CHECKLIST_DIR, CHECKLIST_FILE, listManualItems, parseChecklistFile, serializeChecklistFile,
  type BrokenReference, type ChecklistDocument, type ChecklistSource, type ManualItem, type StaleFigure,
} from "./checklist.js";
import { scanTodos, type TodoItem } from "./todoMarkers.js";
import { scanNoteTasks, type NoteTask } from "./noteTasks.js";
import { readNoteOrigins, type NoteOrigin, type OriginNoteReader } from "./noteOrigins.js";
import type { ProjectNotesStore } from "../../qmd/index.js";

const MODULE = "checklist";

// --- Manual items ---

/** @returns the valid hand-added items; a missing file reads as none, an unreadable or malformed one reads as none and is logged */
export async function readManualItems({ fs, paths, logger }: ProjectReadContext, folder: string): Promise<ManualItem[]> {
  const file = paths.join(folder, CHECKLIST_DIR, CHECKLIST_FILE);
  try {
    const text = await readOptionalText(fs, file);
    if (text === undefined) { return []; }
    const doc = parseChecklistFile(text);
    if (doc === undefined) {
      await logger.log("WARN", MODULE, "checklist.json is not a JSON object with an items array; its items are hidden", { file });
      return [];
    }
    return listManualItems(doc);
  } catch (error) {
    await logger.error(MODULE, error, { file, action: "read" });
    return [];
  }
}

// --- Editing the file ---

/** A file that does not parse is left untouched and the call fails, so no coauthor's item is lost. */
export async function updateChecklist(
  { fs, paths, logger }: ProjectReadContext, folder: string, edit: (doc: ChecklistDocument) => ChecklistDocument,
): Promise<void> {
  const file = paths.join(folder, CHECKLIST_DIR, CHECKLIST_FILE);
  const text = await readOptionalText(fs, file);
  const current = text === undefined ? { items: [] } : parseChecklistFile(text);
  if (current === undefined) {
    const error = new Error(`${file} is malformed; fix or delete it before the checklist can be edited`);
    await logger.error("writing/checklist", error, { file });
    throw error;
  }
  const nextText = serializeChecklistFile(edit(current));
  if (nextText !== text) { await fs.writeText(file, nextText); }
}

// --- Signals ---

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export interface ChecklistSignals {
  /** The main file first, then LaTeX includes depth-first; a Typst project lists only its main file. */
  sources: ChecklistSource[];
  todos: TodoItem[];
  brokenRefs: BrokenReference[];
  staleFigures: StaleFigure[];
  manual: ManualItem[];
  /** The task lines of the project's notes; empty without a notes store. */
  noteTasks: NoteTask[];
  /** The stale, diverged, both and missing note origins of the sources; empty without a note reader. */
  noteOrigins: NoteOrigin[];
  /** Note file to note title; empty without a notes store. */
  noteTitles: Map<string, string>;
}

/** The project's notes store and the project id it reads them by. */
export interface ProjectNotesSource { store: ProjectNotesStore; projectId: string }

/** A note that cannot be read is logged and left out, so one bad file never hides the others. */
async function readNoteTasks({ logger }: ProjectReadContext, { store, projectId }: ProjectNotesSource): Promise<Pick<ChecklistSignals, "noteTasks" | "noteTitles">> {
  const noteTasks: NoteTask[] = [];
  const noteTitles = new Map<string, string>();
  try {
    for (const { path, title } of await store.list(projectId)) {
      noteTitles.set(path, title);
      try {
        noteTasks.push(...scanNoteTasks(path, (await store.read(projectId, path)) ?? ""));
      } catch (error) {
        await logger.error(MODULE, error, { projectId, path, action: "read note tasks" });
      }
    }
  } catch (error) {
    await logger.error(MODULE, error, { projectId, action: "list notes" });
  }
  return { noteTasks, noteTitles };
}

/** A reader that fails is logged and the project lists no origins, so one bad note never hides the other signals. */
async function readOriginsSafely({ logger }: ProjectReadContext, sources: readonly ChecklistSource[], readNote: OriginNoteReader): Promise<NoteOrigin[]> {
  try {
    return await readNoteOrigins(sources, readNote);
  } catch (error) {
    await logger.error(MODULE, error, { action: "read note origins" });
    return [];
  }
}

const readProjectFile = ({ fs, paths }: ProjectReadContext, folder: string, relative: string): Promise<string | undefined> =>
  readOptionalText(fs, paths.join(folder, relative));

async function readLatexSources(context: ProjectReadContext, folder: string, main: string): Promise<{ sources: ChecklistSource[]; brokenRefs: BrokenReference[] }> {
  const tree = await readLatexProjectTexts(main, { read: (relative) => readProjectFile(context, folder, relative) });
  const sources = tree.files.map((file): ChecklistSource => ({ path: file.path, format: "latex", text: tree.texts.get(file.path) ?? "" }));
  const brokenRefs = findUndefinedReferences(tree.files).map(({ path: file, ref }) => ({ file, line: ref.range.start.line, ref: ref.name }));
  return { sources, brokenRefs };
}

async function readSources(context: ProjectReadContext, project: ReadyProject, main: string): Promise<{ sources: ChecklistSource[]; brokenRefs: BrokenReference[] }> {
  if (project.settings.format === "latex") { return readLatexSources(context, project.folder, main); }
  const text = await readProjectFile(context, project.folder, main);
  return { sources: text === undefined ? [] : [{ path: main, format: "typst", text }], brokenRefs: [] };
}

async function readStaleFigures(context: ProjectReadContext, project: ReadyProject): Promise<StaleFigure[]> {
  const figures = project.settings.figures;
  if (figures === undefined) { return []; }
  try {
    const states = await readFigureBuildStates(context, project.folder, figures);
    return Object.entries(states).filter(([, state]) => state.status === "stale").map(([name]) => ({ name }));
  } catch (error) {
    await context.logger.error(MODULE, error, { folder: project.folder, action: "read figure states" });
    return [];
  }
}

/** An unreadable or missing main file yields empty signals and one warning, so a list row never fails on one project. */
export async function readChecklistSignals(
  context: ProjectReadContext, project: ReadyProject, notes?: ProjectNotesSource, readNote?: OriginNoteReader,
): Promise<ChecklistSignals> {
  const { logger } = context;
  const { noteTasks, noteTitles } = notes ? await readNoteTasks(context, notes) : { noteTasks: [], noteTitles: new Map<string, string>() };
  const empty: ChecklistSignals = { sources: [], todos: [], brokenRefs: [], staleFigures: [], manual: [], noteTasks, noteOrigins: [], noteTitles };
  const main = project.main;
  const where = { folder: project.folder, main };
  if (main === undefined) {
    await logger.log("WARN", MODULE, "Project has no main file; its checklist signals are empty", where);
    return empty;
  }
  let read: { sources: ChecklistSource[]; brokenRefs: BrokenReference[] };
  try {
    read = await readSources(context, project, main);
  } catch (error) {
    await logger.log("WARN", MODULE, "Project sources could not be read; its checklist signals are empty", { ...where, error: String(error) });
    return empty;
  }
  if (read.sources[0]?.path !== main) {
    await logger.log("WARN", MODULE, "Project main file is missing; its checklist signals are empty", where);
    return empty;
  }
  const todos = read.sources.flatMap((source) => scanTodos(source.format, source.path, source.text));
  const [staleFigures, manual] = await Promise.all([readStaleFigures(context, project), readManualItems(context, project.folder)]);
  const noteOrigins = readNote ? await readOriginsSafely(context, read.sources, readNote) : [];
  return { sources: read.sources, todos, brokenRefs: read.brokenRefs, staleFigures, manual, noteTasks, noteOrigins, noteTitles };
}
