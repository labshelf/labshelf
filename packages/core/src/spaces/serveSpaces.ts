// Serves the Spaces pages from the Space store and a host port: posts the open view after each change and runs the page's actions.
import type { ILogger } from "../ports/index.js";
import {
  parseSpacesMessage,
  type HostToSpaces,
  type PaperPickItem,
  type SpacesEndpoint,
  type SpacesToHost,
  type SpaceMutation,
  type SpaceQmdAction,
} from "./spacesProtocol.js";
import type { SpacesHostPort } from "./spacesHostPort.js";
import type { SpaceStore } from "./spaceStore.js";
import { buildIcs, buildOverview } from "./spaceOverview.js";
import { buildPapersTree, deriveCatalogRows, resolvePaper } from "./spaceViews.js";
import { formatError } from "../errors/index.js";
import { createCellRuns, type CellRuns, type RunCellPort } from "../qmd/compute/index.js";

const LOAD_CATALOG = "Load Spaces";
const LOAD_SPACE = "Load Space";

const ACTION_LABELS: Record<Exclude<SpacesToHost["type"], "ready">, string> = {
  createSpace: "Create Space",
  renameSpace: "Rename Space",
  setPurpose: "Set purpose",
  deleteSpace: "Delete Space",
  addPapers: "Add papers",
  removePaper: "Remove paper",
  setFocus: "Set focus",
  moveReference: "Move paper",
  createFolder: "Create folder",
  renameFolder: "Rename folder",
  deleteFolder: "Delete folder",
  linkProject: "Link project",
  unlinkProject: "Unlink project",
  addDate: "Add date",
  updateDate: "Update date",
  removeDate: "Remove date",
  setDone: "Mark task done",
  addTerm: "Add term",
  updateTerm: "Update term",
  removeTerm: "Remove term",
  createSpaceNote: "Create note",
  createSpaceThread: "Create thread",
  readSpaceQmd: "Open note or thread",
  addSpaceItem: "Add item",
  editSpaceItem: "Edit item",
  removeSpaceItem: "Remove item",
  setThreadStatus: "Set thread status",
  openPaper: "Open paper",
  selectPaper: "Show paper details",
  openProject: "Open project",
  openSpace: "Open Space",
  openCatalog: "Open Spaces",
  exportIcs: "Export calendar",
  listPapers: "List papers",
  listProjects: "List projects",
  "space.runCell": "Run cell",
  "space.cancelCell": "Cancel cell",
  "space.installPython": "Install Python",
};

/** Resolves to the new id for the mutations that create something. */
function applySpaceMutation(store: SpaceStore, m: SpaceMutation): Promise<unknown> {
  switch (m.type) {
    case "createSpace": return store.createSpace(m.name);
    case "renameSpace": return store.renameSpace(m.id, m.name);
    case "setPurpose": return store.setPurpose(m.id, m.purpose);
    case "deleteSpace": return store.deleteSpace(m.id);
    case "addPapers": return store.addPapers(m.id, m.paperIds, m.folder);
    case "removePaper": return store.removePaper(m.id, m.paperId);
    case "setFocus": return store.setFocus(m.id, m.paperId, m.focus);
    case "moveReference": return store.moveReference(m.id, m.paperId, m.folder);
    case "createFolder": return store.createFolder(m.id, m.name, m.parent);
    case "renameFolder": return store.renameFolder(m.id, m.folderId, m.name);
    case "deleteFolder": return store.deleteFolder(m.id, m.folderId);
    case "linkProject": return store.linkProject(m.id, m.projectId);
    case "unlinkProject": return store.unlinkProject(m.id, m.projectId);
    case "addDate": return store.addDate(m.id, m.date);
    case "updateDate": return store.updateDate(m.id, m.dateId, m.date);
    case "removeDate": return store.removeDate(m.id, m.dateId);
    case "setDone": return store.setDone(m.id, m.dateId, m.done);
    case "addTerm": return store.addTerm(m.id, m.term);
    case "updateTerm": return store.updateTerm(m.id, m.termId, m.term);
    case "removeTerm": return store.removeTerm(m.id, m.termId);
  }
}

const MODULE = "spaces/server";
const DEFAULT_AUTHOR = "Me";

export interface ServeSpacesOptions {
  readonly store: SpaceStore;
  readonly port: SpacesHostPort;
  readonly logger: ILogger;
  /** The local calendar day, YYYY-MM-DD. */
  readonly today: () => string;
  /** The author stamped on the items and thread messages the page adds; DEFAULT_AUTHOR when absent. */
  readonly author?: string;
  /** Runs a note's code cell; absent means the host has no runner and the notes show no Run button. */
  readonly runCell?: RunCellPort;
  /** Installs the Python that cells run with, as the missing-python prompt asks. */
  readonly installPython?: () => void;
}

type OpenView = Extract<SpacesToHost, { type: "ready" }>;
type CellMessage = Extract<SpacesToHost, { type: "space.runCell" | "space.cancelCell" | "space.installPython" }>;
type Action = Exclude<SpacesToHost, { type: "ready" } | CellMessage>;
type Post = (message: HostToSpaces) => void;
type NotesAndThreads = Pick<SpaceStore, "notes" | "discussions">;

const isThreadPath = (path: string): boolean => path.startsWith("discussions/");

/** Posts the items of one file, from the notes or the discussions store by its folder. */
async function postQmd({ notes, discussions }: NotesAndThreads, post: Post, spaceId: string, path: string): Promise<void> {
  const items = await (isThreadPath(path) ? discussions : notes).read(spaceId, path);
  post({ type: "spaceQmd", spaceId, path, items });
}

async function postNotes({ notes }: NotesAndThreads, post: Post, spaceId: string): Promise<void> {
  post({ type: "spaceNotes", spaceId, notes: await notes.list(spaceId) });
}

async function postThreads({ discussions }: NotesAndThreads, post: Post, spaceId: string): Promise<void> {
  post({ type: "spaceDiscussions", spaceId, threads: await discussions.list(spaceId) });
}

/** Posts the list of the folder the file is in, whose title, count or status the change may have moved. */
function postListOf(stores: NotesAndThreads, post: Post, spaceId: string, path: string): Promise<void> {
  return isThreadPath(path) ? postThreads(stores, post, spaceId) : postNotes(stores, post, spaceId);
}

type ItemChange = Extract<SpaceQmdAction, { type: "addSpaceItem" | "editSpaceItem" | "removeSpaceItem" | "setThreadStatus" }>;

/** Applies the change to the notes or the discussions store by the folder of its path. */
async function changeItem({ notes, discussions }: NotesAndThreads, author: string, m: ItemChange): Promise<void> {
  const thread = isThreadPath(m.path);
  switch (m.type) {
    case "addSpaceItem":
      await (thread ? discussions.addMessage(m.spaceId, m.path, m.body, author) : notes.addItem(m.spaceId, m.path, m.body, author));
      return;
    case "editSpaceItem":
      await (thread ? discussions.editMessage(m.spaceId, m.path, m.id, m.body) : notes.editItem(m.spaceId, m.path, m.id, m.body));
      return;
    case "removeSpaceItem":
      await (thread ? discussions.removeMessage(m.spaceId, m.path, m.id) : notes.removeItem(m.spaceId, m.path, m.id));
      return;
    case "setThreadStatus": await discussions.setStatus(m.spaceId, m.path, m.status);
  }
}

async function runQmdAction(stores: NotesAndThreads, author: string, post: Post, m: SpaceQmdAction): Promise<void> {
  switch (m.type) {
    case "createSpaceNote": await stores.notes.create(m.spaceId, m.title); return postNotes(stores, post, m.spaceId);
    case "createSpaceThread": await stores.discussions.create(m.spaceId, m.title, m.body, author); return postThreads(stores, post, m.spaceId);
    case "readSpaceQmd": return postQmd(stores, post, m.spaceId, m.path);
    case "setThreadStatus": await changeItem(stores, author, m); return postThreads(stores, post, m.spaceId);
    default:
      await changeItem(stores, author, m);
      await postQmd(stores, post, m.spaceId, m.path);
      return postListOf(stores, post, m.spaceId, m.path);
  }
}

/** Runs a cell of an open Space's note or thread, stores its output with the item, posts the items again, then `space.cellState`. */
function runSpaceCell(
  { store, runCell, logger }: ServeSpacesOptions, runs: CellRuns, post: Post, spaceId: string, m: Extract<CellMessage, { type: "space.runCell" }>,
): Promise<void> {
  const thread = isThreadPath(m.path);
  return runs.run(runCell, { ...m, language: "python", noteKey: `${spaceId}/${m.path}` }, {
    read: async () => (await (thread ? store.discussions : store.notes).read(spaceId, m.path)).find((item) => item.id === m.itemId)?.body,
    write: (body) => thread ? store.discussions.editMessage(spaceId, m.path, m.itemId, body) : store.notes.editItem(spaceId, m.path, m.itemId, body),
    push: async () => { await postQmd(store, post, spaceId, m.path); await postListOf(store, post, spaceId, m.path); },
    post: (state) => post({ type: "space.cellState", requestId: m.requestId, state }),
    fail: (error) => { void logger.log("ERROR", MODULE, "Running a cell failed", { path: m.path, error: formatError(error) }); },
  });
}

async function readReadySpace(store: SpaceStore, id: string) {
  const result = await store.read(id);
  if (result.state === "unreadable") { throw new Error(result.reason); }
  return result;
}

async function spaceMessage(options: ServeSpacesOptions, id: string): Promise<HostToSpaces> {
  const { store, port, today } = options;
  const [{ space, readOnlyReason }, glossary, projects] = await Promise.all([readReadySpace(store, id), store.readGlossary(id), port.projects()]);
  const library = port.library();
  return {
    type: "space",
    space,
    ...(readOnlyReason !== undefined ? { readOnlyReason } : {}),
    overview: buildOverview(space, library, projects, today()),
    papers: buildPapersTree(space, library),
    glossary: { terms: glossary.glossary.terms, ...(glossary.readOnlyReason !== undefined ? { readOnlyReason: glossary.readOnlyReason } : {}) },
    projects,
    ...(options.runCell ? { canRunCells: true } : {}),
  };
}

function viewMessage(options: ServeSpacesOptions, view: OpenView): Promise<HostToSpaces> {
  if (view.view === "space") { return spaceMessage(options, view.id); }
  return Promise.resolve({ type: "catalog", rows: deriveCatalogRows(options.store.list(), options.port.library(), options.today()) });
}

function pickablePapers(port: SpacesHostPort): PaperPickItem[] {
  const library = port.library();
  return [...library.keys()].map((id) => resolvePaper(id, library)).filter((paper): paper is PaperPickItem => !paper.missing);
}

async function exportIcs({ store, port }: ServeSpacesOptions, id: string): Promise<void> {
  const [{ space }, projects] = await Promise.all([readReadySpace(store, id), port.projects()]);
  await port.saveFile(`${id}.ics`, buildIcs(space, projects, Date.now()));
}

async function runAction(options: ServeSpacesOptions, post: Post, message: Action): Promise<void> {
  const { store, port } = options;
  switch (message.type) {
    case "openPaper": return port.openPaper(message.paperId);
    case "selectPaper": return port.selectPaper(message.paperId);
    case "openProject": return port.openProject(message.projectId);
    case "openSpace": return port.openSpace(message.id, message.tab);
    case "openCatalog": return port.openCatalog();
    case "exportIcs": return exportIcs(options, message.id);
    case "listPapers": post({ type: "papers", items: pickablePapers(port) }); return;
    case "listProjects": post({ type: "projects", items: await port.projects() }); return;
    case "createSpace": return port.openSpace(await store.createSpace(message.name));
    case "createSpaceNote": case "createSpaceThread": case "readSpaceQmd": case "addSpaceItem": case "editSpaceItem":
    case "removeSpaceItem": case "setThreadStatus": return runQmdAction(store, options.author ?? DEFAULT_AUTHOR, post, message);
    default: await applySpaceMutation(store, message);
  }
}

type Fail = (action: string, error: unknown, context: Record<string, unknown>) => void;

/** A cell runs in the Space the page has open; its path is relative to that Space. */
function answerCell(options: ServeSpacesOptions, runs: CellRuns, post: Post, open: OpenView | undefined, message: CellMessage, fail: Fail): void {
  switch (message.type) {
    case "space.cancelCell": runs.cancel(message.requestId); return;
    case "space.installPython": options.installPython?.(); return;
    case "space.runCell": {
      const label = ACTION_LABELS[message.type];
      if (open?.view !== "space") {
        fail(label, new Error("No Space is open."), failureContext(message));
        post({ type: "space.cellState", requestId: message.requestId, state: "error" });
        return;
      }
      runSpaceCell(options, runs, post, open.id, message).catch((error: unknown) => fail(label, error, failureContext(message)));
    }
  }
}

function failureContext(message: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(message).filter(([, value]) => typeof value === "string"));
}

export function serveSpaces(endpoint: SpacesEndpoint, options: ServeSpacesOptions): () => void {
  const { store, port, logger } = options;
  const post: Post = (message) => endpoint.post(message);
  let open: OpenView | undefined;
  let queued = false;
  let tail: Promise<void> = Promise.resolve();
  const runs = createCellRuns();

  const fail = (action: string, error: unknown, context: Record<string, unknown>): void => {
    const reason = formatError(error);
    void logger.log("ERROR", MODULE, `${action} failed`, { ...context, error: reason });
    post({ type: "error", action, message: `${action} failed: ${reason}` });
  };
  const postView = async (): Promise<void> => {
    const view = open;
    if (!view) { return; }
    try {
      post(await viewMessage(options, view));
      if (view.view === "space") {
        await postNotes(store, post, view.id);
        await postThreads(store, post, view.id);
      }
    } catch (error) {
      if (view.view === "space") { fail(LOAD_SPACE, error, { id: view.id }); } else { fail(LOAD_CATALOG, error, { view: "catalog" }); }
    }
  };
  // INVARIANT: at most one post waits behind the running one, so changes in one tick post once and a later change still posts.
  const schedule = (): void => {
    if (!open || queued) { return; }
    queued = true;
    tail = tail.then(() => { queued = false; return postView(); });
  };

  const stopMessages = endpoint.subscribe((raw) => {
    const message = parseSpacesMessage(raw);
    if (!message) {
      void logger.log("WARN", MODULE, "Spaces page message rejected", { type: (raw as { type?: unknown } | null)?.type });
      return;
    }
    if (message.type === "ready") { open = message; schedule(); return; }
    if (message.type === "space.runCell" || message.type === "space.cancelCell" || message.type === "space.installPython") { answerCell(options, runs, post, open, message, fail); return; }
    runAction(options, post, message).catch((error: unknown) => fail(ACTION_LABELS[message.type], error, failureContext(message)));
  });
  const stops = [stopMessages, store.onChange(schedule), port.onLibraryChange(schedule), port.onProjectsChange(schedule)];
  return () => { for (const stop of stops) { stop(); } };
}
