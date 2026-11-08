// Keeps the page's project session: its open source editors, the sidebar snapshot it publishes, opening and closing the project and reopening a restored one.
import {
  deckFolderName, deckRootOf, findFreeDeckName, listDeckKits, scaffoldDeckFromTemplate, sourceDeckMainFile,
  parseTab, toggleNoteTask, formatError, posixPathOps, readFilesRowPath,
  type ChecklistGrouping, type DeckKind, type DeckKit, type DeckKitStoreDeps, type DeckTemplateChoice, type DeckTemplateGalleryInit, type SourceDeckFormat, type ILogger, type LibraryFileSystem, type ProjectEntry, type ProjectTreeView, type SidebarOpenProject,
} from "@labshelf/core";
import { QMD_VOCABULARY, askDialog, askInputBox, showToast } from "@labshelf/core/dom";
import { mountSourceEditor as mountCoreSourceEditor, type SourceEditor, type SourceEditorDeps } from "@labshelf/core/sourceEditor";
import { createCommentSupport } from "../collab";
import type { OpenProjectSnapshot, SessionNotes } from "./snapshot";
import type { Workspace } from "../libraryUi/editorArea";
import { openNewDeckDialog } from "../libraryUi/newDeckDialog";

// The open-editor registry and the editor types live in core; these keep the browser's import path.
export { refreshProjectEditors, registerOpenEditor, showInOpenEditor, writeProjectEditors, type SourceEditor, type SourceEditorDeps, type SourceFileAccess } from "@labshelf/core/sourceEditor";

/** Mounts core's CodeMirror source editor with the browser's comment support (its source footer and body editor). */
export function mountSourceEditor(host: HTMLElement, deps: SourceEditorDeps): Promise<SourceEditor> {
  return mountCoreSourceEditor(host, { commentSupport: createCommentSupport, ...deps });
}

/** The source editor's mount function, for the source tab. */
export function loadSourceEditor(): Promise<{ mountSourceEditor: typeof mountSourceEditor }> {
  return Promise.resolve({ mountSourceEditor });
}

const MODULE = "writing.session";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

/** What the session drives in the sidebar. */
interface SessionSidebar {
  setOpenProject(snapshot: SidebarOpenProject | undefined): void;
}

export interface ProjectSessionOptions {
  workspace: Pick<Workspace, "openTab" | "closeTabs">;
  snapshot: OpenProjectSnapshot;
  logger: ILogger;
  /** Called for an outline click with the file and the zero-based line of the heading. */
  onReveal?: (path: string, line: number) => void;
  /** The project's notes; without them New note and ticking a note task do nothing. */
  notes?: SessionNotes;
  /** The disk Import files, New Presentation and New Poster write to; without it none is offered. */
  fs?: Pick<LibraryFileSystem, "exists" | "writeFile" | "ensureDir" | "writeText" | "readText" | "listDir">;
  /** Called after a project opens (with its entry) and after it closes (undefined). */
  onProjectChange?: (entry: ProjectEntry | undefined) => void | Promise<void>;
}

export interface ProjectSession {
  /** Closes another open project first; false when that stayed open or the entry cannot be opened. */
  openProject(entry: ProjectEntry): Promise<boolean>;
  /** Closes the open project's tabs; false when one stayed open. */
  closeProject(): Promise<boolean>;
  current(): ProjectEntry | undefined;
  attachSidebar(sidebar: SessionSidebar): void;
  treeClick(view: ProjectTreeView, key: string): void;
  /** Ticks a checklist row: a note task flips its box in its note; the checklist is read again afterwards. */
  treeCheck(view: ProjectTreeView, key: string): Promise<void>;
  /** Runs a toolbar or toggle action of a tree or of the project menu: byKind and bySection switch the checklist grouping, newTalk and newPoster make a presentation or poster. */
  treeAction(action: string): Promise<void>;
}

const projectIdOf = (entry: ProjectEntry): string | undefined => (entry.kind === "ready" ? entry.settings.id : undefined);
const mainOf = (entry: ProjectEntry): string | undefined => (entry.kind === "ready" ? entry.main : undefined);

function belongsTo(projectId: string): (tabId: string) => boolean {
  return (tabId) => {
    const tab = parseTab(tabId);
    return tab !== null && (tab.kind === "source" || tab.kind === "preview" || tab.kind === "comments" || tab.kind === "history") && tab.params["projectId"] === projectId;
  };
}

async function notifyProjectChange({ logger, onProjectChange }: Pick<ProjectSessionOptions, "logger" | "onProjectChange">, entry: ProjectEntry | undefined): Promise<void> {
  try {
    await onProjectChange?.(entry);
  } catch (error) {
    await logger.error(MODULE, error, { action: "notify project change", folder: entry?.folder });
  }
}

/** A click in the files tree opens the file; one in the outline reveals the heading (its key is the path, a colon and the zero-based line). */
function clickTree({ workspace, onReveal, notes }: Pick<ProjectSessionOptions, "workspace" | "onReveal" | "notes">, projectId: string, view: ProjectTreeView, key: string): void {
  if (view === "checklist") {
    const task = notes?.tasks.get(key);
    if (task) workspace.openTab("source", { projectId, path: task.file }, 0);
    return;
  }
  if (view === "files") { workspace.openTab("source", { projectId, path: readFilesRowPath(key) }, 0); return; }
  if (view !== "outline") { return; }
  const colon = key.lastIndexOf(":");
  const line = Number(key.slice(colon + 1));
  if (colon > 0 && Number.isInteger(line)) { onReveal?.(key.slice(0, colon), line); }
}

/** What the session remembers between calls. */
interface SessionState {
  sidebar: SessionSidebar | undefined;
  open: ProjectEntry | undefined;
  grouping: ChecklistGrouping;
  // Bumped by every open and close, so a snapshot that finishes after the project changed is dropped.
  generation: number;
}

type SessionContext = ProjectSessionOptions & { state: SessionState };

async function publish({ snapshot, logger, state }: SessionContext, entry: ProjectEntry, mine: number): Promise<void> {
  try {
    const built = await snapshot(entry, state.grouping);
    if (mine === state.generation) { state.sidebar?.setOpenProject(built); }
  } catch (error) {
    await logger.error(MODULE, error, { action: "build open project snapshot", folder: entry.folder });
  }
}

async function openProject(context: SessionContext, session: ProjectSession, entry: ProjectEntry): Promise<boolean> {
  const { workspace, logger, state } = context;
  const id = projectIdOf(entry);
  if (id === undefined) {
    await logger.log("WARN", MODULE, "A broken project cannot be opened", { folder: entry.folder });
    return false;
  }
  if (state.open !== undefined && projectIdOf(state.open) !== id && !(await session.closeProject())) { return false; }
  state.open = entry;
  const mine = ++state.generation;
  const main = mainOf(entry);
  if (main !== undefined) { workspace.openTab("source", { projectId: id, path: main }, 0); }
  workspace.openTab("preview", { projectId: id }, 1);
  await publish(context, entry, mine);
  await notifyProjectChange(context, entry);
  return true;
}

async function closeProject(context: SessionContext): Promise<boolean> {
  const { workspace, state } = context;
  if (state.open === undefined) { return true; }
  const id = projectIdOf(state.open);
  if (id !== undefined && !(await workspace.closeTabs(belongsTo(id)))) { return false; }
  state.open = undefined;
  state.generation += 1;
  state.sidebar?.setOpenProject(undefined);
  await notifyProjectChange(context, undefined);
  return true;
}

async function createNote(context: SessionContext, projectId: string): Promise<void> {
  const { workspace, notes, logger, state } = context;
  if (!notes) { return; }
  const title = await askInputBox({
    title: `New ${QMD_VOCABULARY.item}`, prompt: `${QMD_VOCABULARY.item[0]!.toUpperCase()}${QMD_VOCABULARY.item.slice(1)} title`,
    validate: (value) => (value.trim() === "" ? "Enter a title." : undefined),
  });
  if (title === undefined || title.trim() === "") { return; }
  try {
    const path = await notes.store.create(projectId, title.trim());
    workspace.openTab("source", { projectId, path }, 0);
    const open = state.open;
    if (open !== undefined) { await publish(context, open, ++state.generation); }
  } catch (error) {
    await logger.error(MODULE, error, { action: "create note", projectId });
    showToast(formatError(error), "error");
  }
}

/** The files the user picks on their computer; empty when they cancel. */
function pickLocalFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", multiple: true });
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

/** Copies files from the user's computer to the project's folder, asking before replacing one, then refreshes the tree. */
async function importFiles(context: SessionContext): Promise<void> {
  const { fs, logger, state } = context;
  const open = state.open;
  if (!fs || open === undefined) { return; }
  const files = await pickLocalFiles();
  let imported = 0;
  for (const file of files) {
    const target = `${open.folder}/${file.name}`;
    try {
      if (await fs.exists(target) && !(await askDialog("Replace file", `${file.name} already exists in the project.`, "Replace"))) { continue; }
      await fs.writeFile(target, new Uint8Array(await file.arrayBuffer()));
      imported++;
    } catch (error) {
      await logger.error(MODULE, error, { action: "import file", file: file.name });
      showToast(`Could not import ${file.name}: ${formatError(error)}`, "error");
    }
  }
  if (imported === 0 || state.open !== open) { return; }
  showToast(imported === 1 ? `Imported ${files.length === 1 ? files[0]!.name : "1 file"}` : `Imported ${imported} files`, "info");
  await publish(context, open, ++state.generation);
}

const formatOf = (project: ReadyProject): SourceDeckFormat => (project.settings.format === "typst" ? "typst" : "latex");

/**
 * Writes a new presentation or poster into the project from the template gallery's choice: a visual deck (deck.html and theme.css) or the project
 * format's source (main.tex or main.typ) in talks/<name>/ or posters/<name>/. `options.kits` (default none) are offered as palettes and `options.pick`
 * (default the gallery dialog) asks the user. Returns the project-relative path to open, or undefined when the user cancelled.
 */
export async function createDeck(fs: Pick<LibraryFileSystem, "exists" | "ensureDir" | "writeText">, project: ReadyProject, kind: DeckKind, options?: { kits?: DeckKit[]; pick?: (init: DeckTemplateGalleryInit) => Promise<DeckTemplateChoice | null> }): Promise<string | undefined> {
  const pick = options?.pick ?? openNewDeckDialog;
  const choice = await pick({ kind, formats: ["html", formatOf(project)], kits: options?.kits ?? [] });
  if (!choice) return undefined;
  const root = posixPathOps.join(project.folder, deckRootOf(choice.kind));
  const name = await findFreeDeckName({ fs, paths: posixPathOps }, root, deckFolderName(choice.title));
  const folder = posixPathOps.join(root, name);
  const files = scaffoldDeckFromTemplate(choice, name);
  await fs.ensureDir(folder);
  for (const file of files) await fs.writeText(posixPathOps.join(folder, file.path), file.text);
  const main = choice.format === "html" ? "deck.html" : sourceDeckMainFile(choice.format);
  return `${deckRootOf(choice.kind)}/${name}/${main}`;
}

/** The library's Kits for the gallery (the kits folder at the library root, as the deck tabs' Kits port reads it); none when they cannot be read. */
async function listKits(fs: DeckKitStoreDeps["fs"]): Promise<DeckKit[]> {
  try {
    return await listDeckKits({ fs, paths: posixPathOps, root: "" });
  } catch {
    return [];
  }
}

/** Writes a new presentation or poster into the open project, opens it and refreshes the sidebar. */
async function newDeck(context: SessionContext, projectId: string, kind: DeckKind): Promise<void> {
  const { workspace, fs, logger, state } = context;
  const open = state.open;
  if (!fs || open === undefined || open.kind !== "ready") { return; }
  try {
    const path = await createDeck(fs, open, kind, { kits: await listKits(fs) });
    if (path === undefined) { return; }
    workspace.openTab("source", { projectId, path }, 0);
    if (state.open === open) { await publish(context, open, ++state.generation); }
  } catch (error) {
    await logger.error(MODULE, error, { action: "create deck", projectId });
    showToast(formatError(error), "error");
  }
}

async function tickChecklistRow(context: SessionContext, key: string): Promise<void> {
  const { notes, state, logger } = context;
  const task = notes?.tasks.get(key);
  const open = state.open;
  const id = open === undefined ? undefined : projectIdOf(open);
  if (!notes || !task || open === undefined || id === undefined) { return; }
  try {
    const result = await toggleNoteTask(notes.store, id, task);
    if (result.status === "changed") { showToast("The note changed; the checklist was refreshed", "info"); }
  } catch (error) {
    await logger.error(MODULE, error, { action: "tick note task", projectId: id, file: task.file });
    showToast(formatError(error), "error");
  }
  await publish(context, open, ++state.generation);
}

async function runTreeAction(context: SessionContext, action: string): Promise<void> {
  const { workspace, state } = context;
  const id = state.open === undefined ? undefined : projectIdOf(state.open);
  if (state.open === undefined || id === undefined) { return; }
  if (action === "newNote") { await createNote(context, id); return; }
  if (action === "importFiles") { await importFiles(context); return; }
  if (action === "newTalk" || action === "newPoster") { await newDeck(context, id, action === "newTalk" ? "talk" : "poster"); return; }
  if (action === "comments" || action === "history") { workspace.openTab(action, { projectId: id }, 1); return; }
  if (action !== "byKind" && action !== "bySection") { return; }
  state.grouping = action === "byKind" ? "kind" : "section";
  await publish(context, state.open, ++state.generation);
}

export function createProjectSession(options: ProjectSessionOptions): ProjectSession {
  const context: SessionContext = { ...options, state: { sidebar: undefined, open: undefined, grouping: "kind", generation: 0 } };
  const { state } = context;
  const session: ProjectSession = {
    openProject: (entry) => openProject(context, session, entry),
    closeProject: () => closeProject(context),
    current: () => state.open,
    attachSidebar(next) { state.sidebar = next; },
    treeClick(view, key) {
      const id = state.open === undefined ? undefined : projectIdOf(state.open);
      if (id !== undefined) { clickTree(context, id, view, key); }
    },
    treeAction: (action) => runTreeAction(context, action),
    treeCheck: (view, key) => (view === "checklist" ? tickChecklistRow(context, key) : Promise.resolve()),
  };
  return session;
}


export async function openRestoredProject(workspace: Pick<Workspace, "tabs" | "openTab">, session: ProjectSession, fs: LibraryFileSystem, logger: ILogger): Promise<void> {
  const tabs = workspace.tabs();
  const projectId = tabs.map((t) => parseTab(t.id)?.params["projectId"]).find((id) => id !== undefined);
  if (projectId === undefined) return;
  try {
    // Loaded on demand, so a page without project tabs never loads the project code.
    const { findProject } = await import("./project");
    if (!(await session.openProject(await findProject(fs, logger, undefined, projectId)))) return;
  } catch (error) {
    await logger.error(MODULE, error, { action: "resume restored project", projectId });
    return;
  }
  // Opening the project focuses its main file; the tab the page was showing is focused again.
  const focused = tabs.find((t) => t.focused);
  const tab = focused === undefined ? null : parseTab(focused.id);
  if (tab) workspace.openTab(tab.kind, tab.params);
}
