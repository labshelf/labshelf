// Implements `labshelf cite`: picks a paper on the terminal, prints its citation on stdout and updates labshelf.bib.
import {
  citationSnippet,
  errorMessage,
  type PaperRecord,
  type ProjectFormat,
  DEFAULT_BIBLIOGRAPHY,
  PROJECT_FILE,
  generateBibliography,
  projectCitationKeys,
  readProject,
  updateProjectBibliography,
  type ILogger,
  type ProjectEntry,
  rankFuzzy,
} from "@labshelf/core";

import type { AppContext } from "../../compositionRoot.js";
import { UsageError, type Output } from "../usage.js";
import { openDevTty, type CiteTty } from "./tty.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { nodeProjectReadContext, readOptionalFile, writeFileAtomic } from "@labshelf/core/node";
import { Terminal, Screen, type InputEvent } from "../../screen/index.js";
import { theme, editText, textInput, type TextInputState } from "../../libraryUi/index.js";

interface PickerState {
  query: TextInputState;
  /** Index into the matches. */
  selected: number;
}

type PickerStep = { kind: "state"; state: PickerState } | { kind: "pick"; paper: PaperRecord } | { kind: "cancel" };

const initialPicker = (): PickerState => ({ query: textInput(), selected: 0 });

const label = (paper: PaperRecord): string =>
  [paper.citeKey, paper.title, ...(paper.authors ?? []), paper.year ?? ""].join(" ");

/** @returns the papers matching the query, best first */
function pickerMatches(papers: readonly PaperRecord[], state: PickerState): PaperRecord[] {
  return rankFuzzy(papers, state.query.value, label);
}

function moved(state: PickerState, by: number, count: number): PickerStep {
  return { kind: "state", state: { ...state, selected: Math.min(Math.max(state.selected + by, 0), Math.max(count - 1, 0)) } };
}

/**
 * Applies one input event.
 * @returns the next state, the picked paper, or a cancel
 */
function stepPicker(papers: readonly PaperRecord[], state: PickerState, event: InputEvent): PickerStep {
  const matches = pickerMatches(papers, state);
  if (event.type === "key") {
    switch (event.id) {
      case "enter": {
        const paper = matches[state.selected];
        return paper ? { kind: "pick", paper } : { kind: "state", state };
      }
      case "esc": case "C-c": case "C-g": return { kind: "cancel" };
      case "up": case "C-p": return moved(state, -1, matches.length);
      case "down": case "C-n": return moved(state, 1, matches.length);
      case "pageup": return moved(state, -10, matches.length);
      case "pagedown": return moved(state, 10, matches.length);
      default: break;
    }
  }
  const query = editText(state.query, event);
  return { kind: "state", state: query ? { query, selected: 0 } : state };
}

const HINT = "enter cite   esc cancel   up/down move";

function rowText(paper: PaperRecord): { key: string; rest: string } {
  const author = paper.authors?.[0];
  const detail = [author, paper.year].filter((part) => part !== undefined && part !== "").join(" ");
  return { key: paper.citeKey, rest: `${paper.title}${detail ? `  (${detail})` : ""}` };
}

/** @returns one frame of the picker for a terminal of the given size */
function drawPicker(papers: readonly PaperRecord[], state: PickerState, width: number, height: number): Screen {
  const screen = new Screen(width, height);
  const matches = pickerMatches(papers, state);
  screen.text(0, 0, `Cite a paper (${matches.length} of ${papers.length})`, theme.title);
  screen.text(0, 1, "> ", theme.brand);
  screen.text(2, 1, state.query.value, theme.text, width - 2);
  const rows = Math.max(1, height - 3);
  const first = Math.min(Math.max(state.selected - rows + 1, 0), Math.max(matches.length - rows, 0));
  matches.slice(first, first + rows).forEach((paper, index) => {
    const y = 2 + index;
    const selected = first + index === state.selected;
    const { key, rest } = rowText(paper);
    if (selected) { screen.fill(0, y, width, 1, theme.hover); }
    const keyWidth = screen.text(0, y, key, selected ? theme.hover : theme.bold, width);
    screen.text(keyWidth + 2, y, rest, selected ? theme.hover : theme.text, Math.max(0, width - keyWidth - 2));
  });
  screen.text(0, height - 1, HINT, theme.dim, width);
  return screen;
}

/** The terminal is restored before the promise settles, so the caller prints on a clean screen. */
function pickPaper(papers: readonly PaperRecord[], tty: CiteTty): Promise<PaperRecord | undefined> {
  return new Promise((resolve) => {
    const terminal = new Terminal(tty.input, tty.output);
    let state: PickerState = initialPicker();
    const paint = (): void => {
      const { cols, rows } = terminal.size();
      terminal.draw(drawPicker(papers, state, cols, rows));
    };
    const finish = (paper: PaperRecord | undefined): void => {
      terminal.leave();
      resolve(paper);
    };
    terminal.listen((event) => {
      const step = stepPicker(papers, state, event);
      if (step.kind === "pick") { finish(step.paper); return; }
      if (step.kind === "cancel") { finish(undefined); return; }
      state = step.state;
      paint();
    }, paint);
    terminal.enter();
    paint();
  });
}

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

async function hasProjectFile(folder: string): Promise<boolean> {
  return fs.stat(path.join(folder, PROJECT_FILE)).then((stat) => stat.isFile(), () => false);
}

/** The folder itself, else the nearest folder above it that holds labshelf.yaml. */
async function enclosingProject(start: string, climb: boolean): Promise<string | undefined> {
  for (let folder = start; ; folder = path.dirname(folder)) {
    if (await hasProjectFile(folder)) { return folder; }
    if (!climb || path.dirname(folder) === folder) { return undefined; }
  }
}

/**
 * @param folder the project folder named on the command line, or undefined to search up from the working directory
 * @returns the project, or a reason it cannot take a bibliography
 */
async function locateProject(
  folder: string | undefined, logger: ILogger,
): Promise<{ project: ReadyProject } | { reason: string }> {
  const start = path.resolve(folder ?? process.cwd());
  const found = await enclosingProject(start, folder === undefined);
  if (found === undefined) { return { reason: `no ${PROJECT_FILE} in ${start}` }; }
  const entry = await readProject(nodeProjectReadContext(logger), found, "external");
  return entry.kind === "ready" ? { project: entry } : { reason: entry.reason };
}

/**
 * Regenerates labshelf.bib from the keys the project's sources cite plus the picked paper, which the user is about to
 * paste into a source. updateProjectBibliography runs first so the main file loads the bibliography and labshelf.yaml
 * lists the cited papers; its file lacks the picked key, so the file is completed afterwards.
 */
async function addToBibliography(
  project: ReadyProject, picked: PaperRecord, papers: readonly PaperRecord[], logger: ILogger,
): Promise<void> {
  const context = nodeProjectReadContext(logger);
  await updateProjectBibliography(context, project, papers);
  const keys = [...await projectCitationKeys(context, project.folder, project.settings.format), picked.citeKey];
  const generated = generateBibliography(keys, papers);
  const file = path.join(project.folder, project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY);
  if (await readOptionalFile(file) === generated.text) { return; }
  await writeFileAtomic(file, generated.text);
  await logger.log("INFO", "terminal.cite", "Paper added to the project bibliography", {
    file, key: picked.citeKey, entries: generated.resolved.length,
  });
}

type CiteFormat = ProjectFormat | "key";

const FORMATS: readonly CiteFormat[] = ["latex", "typst", "key"];

function parseFormat(value: string | boolean | undefined, project: ReadyProject | undefined): CiteFormat {
  if (value === undefined) { return project?.settings.format ?? "latex"; }
  if (typeof value === "string" && (FORMATS as readonly string[]).includes(value)) { return value as CiteFormat; }
  throw new UsageError(`--format takes latex, typst or key, not "${String(value)}".`);
}

/**
 * The picker draws on /dev/tty, so stdout carries the citation alone and an editor can capture it.
 * @param positionals an optional project folder; else the project containing the working directory
 * @param tty the terminal to draw on; the controlling terminal when omitted
 * @returns the exit code: 1 when the picker is cancelled or the library is empty
 */
export async function runCite(
  ctx: Pick<AppContext, "store" | "logger">,
  positionals: string[],
  flags: Record<string, string | boolean>,
  io: Output,
  tty?: CiteTty,
): Promise<number> {
  const papers: PaperRecord[] = [...ctx.store.snapshot.papers.values()]
    .map((entry) => entry.record).filter((record) => record.citeKey !== "");
  if (papers.length === 0) {
    io.err("The library has no papers to cite.");
    return 1;
  }
  const located = await locateProject(positionals[0], ctx.logger);
  const project = "project" in located ? located.project : undefined;
  const format = parseFormat(flags["format"], project);
  const terminal = tty ?? openDevTty();
  let picked: PaperRecord | undefined;
  try {
    picked = await pickPaper(papers, terminal);
  } finally {
    terminal.close();
  }
  if (picked === undefined) { return 1; }
  io.out(format === "key" ? picked.citeKey : citationSnippet(format, picked.citeKey));
  if (project === undefined) {
    io.err(`labshelf.bib not updated: ${"reason" in located ? located.reason : ""}.`);
    return 0;
  }
  try {
    await addToBibliography(project, picked, papers, ctx.logger);
  } catch (error) {
    await ctx.logger.error("terminal.cite", error, { folder: project.folder });
    io.err(`labshelf.bib not updated: ${errorMessage(error)}`);
  }
  return 0;
}
