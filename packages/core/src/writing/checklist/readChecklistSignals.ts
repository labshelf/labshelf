// Reads the open-item signals of one writing project: sources, TODOs, broken refs, stale figures and manual items.
import { readFigureStates } from "../figures/index.js";
import { readLatexProjectSources, findUndefinedReferences } from "../../latex/source/project/index.js";
import type { ProjectEntry } from "../project/index.js";
import { readOptionalText, type ProjectReadContext } from "../project/folder/index.js";
import type { BrokenRef, StaleFigure } from "./buildChecklist.js";
import type { ManualItem } from "./checklistFile.js";
import { readManualItems } from "./readManualItems.js";
import type { ChecklistSource } from "./sectionPlacement.js";
import { scanTodos, type TodoItem } from "./scanTodos.js";

const MODULE = "checklist";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export interface ChecklistSignals {
  /** The main file first, then LaTeX includes depth-first; a Typst project lists only its main file. */
  sources: ChecklistSource[];
  todos: TodoItem[];
  brokenRefs: BrokenRef[];
  staleFigures: StaleFigure[];
  manual: ManualItem[];
}

const readProjectFile = ({ fs, paths }: ProjectReadContext, folder: string, relative: string): Promise<string | undefined> =>
  readOptionalText(fs, paths.join(folder, relative));

async function readLatexSources(context: ProjectReadContext, folder: string, main: string): Promise<{ sources: ChecklistSource[]; brokenRefs: BrokenRef[] }> {
  const texts = new Map<string, string>();
  const tree = await readLatexProjectSources(main, {
    read: async (relative) => {
      const text = await readProjectFile(context, folder, relative);
      if (text !== undefined) { texts.set(relative, text); }
      return text;
    },
  });
  const sources = tree.files.map((file): ChecklistSource => ({ path: file.path, format: "latex", text: texts.get(file.path) ?? "" }));
  const brokenRefs = findUndefinedReferences(tree.files).map(({ path: file, ref }) => ({ file, line: ref.range.start.line, ref: ref.name }));
  return { sources, brokenRefs };
}

async function readSources(context: ProjectReadContext, project: ReadyProject, main: string): Promise<{ sources: ChecklistSource[]; brokenRefs: BrokenRef[] }> {
  if (project.settings.format === "latex") { return readLatexSources(context, project.folder, main); }
  const text = await readProjectFile(context, project.folder, main);
  return { sources: text === undefined ? [] : [{ path: main, format: "typst", text }], brokenRefs: [] };
}

async function readStaleFigures(context: ProjectReadContext, project: ReadyProject): Promise<StaleFigure[]> {
  const figures = project.settings.figures;
  if (figures === undefined) { return []; }
  try {
    const states = await readFigureStates(context, project.folder, figures);
    return Object.entries(states).filter(([, state]) => state.status === "stale").map(([name]) => ({ name }));
  } catch (error) {
    await context.logger.error(MODULE, error, { folder: project.folder, action: "read figure states" });
    return [];
  }
}

/** An unreadable or missing main file yields empty signals and one warning, so a list row never fails on one project. */
export async function readChecklistSignals(context: ProjectReadContext, project: ReadyProject): Promise<ChecklistSignals> {
  const { logger } = context;
  const empty: ChecklistSignals = { sources: [], todos: [], brokenRefs: [], staleFigures: [], manual: [] };
  const main = project.main;
  const where = { folder: project.folder, main };
  if (main === undefined) {
    await logger.log("WARN", MODULE, "Project has no main file; its checklist signals are empty", where);
    return empty;
  }
  let read: { sources: ChecklistSource[]; brokenRefs: BrokenRef[] };
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
  return { sources: read.sources, todos, brokenRefs: read.brokenRefs, staleFigures, manual };
}
