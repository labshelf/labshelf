// Serves the Spaces pages from the Space store and a host port: posts the open view after each change and runs the page's actions.
import type { ILogger } from "../ports/index.js";
import type { ProjectChatToHost } from "../projectChat/projectChatProtocol.js";
import {
  parseSpacesMessage,
  type HostToSpaces,
  type PaperPickItem,
  type SpacesEndpoint,
  type SpacesToHost,
} from "./spacesProtocol.js";
import { runShareAction, shareFields, type SpacesHostPort } from "./spacesHostPort.js";
import type { SpaceStore } from "./spaceStore.js";
import { listDeskItems, SPACE_DESK_LIMIT, type Space } from "./space.js";
import { buildIcs, buildOverview, type DeskSources } from "./spaceOverview.js";
import { buildPapersTree, deriveCatalogRows, resolvePaper } from "./spaceViews.js";
import { formatError } from "../errors/index.js";
import { homeMessage, isHomeAction, runHomeAction, HOME_ACTION_LABELS, LOAD_HOME, type ServeHomeOptions } from "./homeView.js";
import { createCellRuns, type CellLanguage, type CellRuns, type RunCellPort } from "../qmd/compute/index.js";
import type { MathOp, MathRequest, MathResult } from "../qmd/compute/index.js";
import { unsupportedNoteFileReply, type NoteFileReply, type NoteFileRequest } from "../qmd/index.js";
import { answerPaperObjectsRequest, unsupportedPaperObjectsReply, type PaperObjectsReply, type PaperObjectsRequest } from "../paperObjects/protocol.js";
import type { PaperObjectsPort } from "../paperObjects/types.js";
import { createSpaceProjectChats } from "./serveSpaceProjectChat.js";
import { applySpaceMutation, isThreadPath, postListOf, postQmd, postNotes, postThreads, runQmdAction } from "./spaceStoreActions.js";

const LOAD_CATALOG = "Load Spaces";
const LOAD_SPACE = "Load Space";

const ACTION_LABELS: Record<Exclude<SpacesToHost["type"], "ready" | "openProjectChat" | `projectChat.${string}` | keyof typeof HOME_ACTION_LABELS>, string> = {
  createSpace: "Create Space", renameSpace: "Rename Space", setPurpose: "Set purpose",
  deleteSpace: "Delete Space", setArchived: "Archive Space", setTrashed: "Move Space to Trash",
  setIcon: "Set Space icon", emptyTrash: "Empty Trash", addPapers: "Add papers",
  removePaper: "Remove paper", pinToDesk: "Pin to desk", unpinFromDesk: "Unpin from desk",
  moveReference: "Move paper", createFolder: "Create folder", renameFolder: "Rename folder",
  deleteFolder: "Delete folder", linkProject: "Link project", unlinkProject: "Unlink project",
  addDate: "Add date", updateDate: "Update date", removeDate: "Remove date",
  setDone: "Mark task done", addTerm: "Add term", updateTerm: "Update term",
  removeTerm: "Remove term", toggleSaved: "Save message", markSeen: "Mark conversation seen", addAgreement: "Record agreement",
  updateAgreement: "Edit agreement", removeAgreement: "Remove agreement", searchDiscussions: "Search discussions",
  createSpaceNote: "Create note", createSpaceThread: "Create thread", readSpaceQmd: "Open note or thread",
  addSpaceItem: "Add item", editSpaceItem: "Edit item", removeSpaceItem: "Remove item",
  setThreadStatus: "Set thread status", openPaper: "Open paper", selectPaper: "Show paper details",
  openProject: "Open project", openSpace: "Open Space", openCatalog: "Open Spaces",
  exportIcs: "Export calendar", shareSpace: "Share Space", leaveSpace: "Stop sharing Space",
  downloadSpacePapers: "Download papers", listPapers: "List papers", listProjects: "List projects",
  "space.runCell": "Run cell", "space.restartCell": "Restart cell process", "space.cancelCell": "Cancel cell",
  "space.installPython": "Install Python", "space.evalMath": "Evaluate math", "space.noteFile": "Read or write note file",
  "space.paperObjects": "Insert from paper",
  setConversationPresence: "Show conversation presence",
};

const MODULE = "spaces/server";
const DEFAULT_AUTHOR = "Me";

export interface ServeSpacesOptions extends ServeHomeOptions {
  readonly store: SpaceStore;
  readonly port: SpacesHostPort;
  readonly logger: ILogger;
  /** The local calendar day, YYYY-MM-DD. */
  readonly today: () => string;
  /** The author stamped on the items and thread messages the page adds, or a getter read on every use; DEFAULT_AUTHOR when absent. */
  readonly author?: string | (() => string);
  /** Runs a note's code cell; absent means the host has no runner and the notes show no Run button. */
  readonly runCell?: RunCellPort;
  /** Restarts one note's process for a language; absent where the host has no runner. */
  readonly restartCell?: (noteKey: string, language: CellLanguage) => Promise<void>;
  /** Evaluates or checks one piece of prose math on a note's session; absent where the host has no runner, and space.evalMath answers a failed result. */
  readonly runMath?: (request: MathRequest, signal?: AbortSignal) => Promise<MathResult>;
  /** Installs the Python that cells run with, as the missing-python prompt asks. */
  readonly installPython?: () => void;
  /** Answers a file request of the note at `notePath` in Space `spaceId`; absent means the notes are told note files are not supported. */
  readonly noteFiles?: (spaceId: string, notePath: string, request: NoteFileRequest) => Promise<NoteFileReply>;
  /** The library's papers for the notes' From paper…; absent means the notes hide it and space.paperObjects answers that it is not available. */
  readonly paperObjects?: PaperObjectsPort;
}

/** Posts the port's answer to a note's From paper… call, or an error reply without the port, so the picker never waits. */
async function answerSpacePaperObjects(options: Pick<ServeSpacesOptions, 'paperObjects'>, request: PaperObjectsRequest, post: (reply: PaperObjectsReply) => void): Promise<void> {
  post(options.paperObjects ? await answerPaperObjectsRequest(options.paperObjects, request) : unsupportedPaperObjectsReply(request));
}

/** Posts the host's answer to a Space note's file request, or an error reply without the hook, so the editor never waits. */
export async function answerSpaceNoteFile(options: Pick<ServeSpacesOptions, 'noteFiles'>, message: { spaceId: string; path: string; request: NoteFileRequest }, post: (reply: NoteFileReply) => void): Promise<void> {
  post(options.noteFiles ? await options.noteFiles(message.spaceId, message.path, message.request) : unsupportedNoteFileReply(message.request));
}

/** The author now: the getter's current value, the string, or DEFAULT_AUTHOR. */
const authorOf = ({ author }: Pick<ServeSpacesOptions, "author">): string => (typeof author === "function" ? author() : author) ?? DEFAULT_AUTHOR;

type OpenView = Extract<SpacesToHost, { type: "ready" }>;
type CellMessage = Extract<SpacesToHost, { type: "space.runCell" | "space.restartCell" | "space.cancelCell" | "space.installPython" | "space.evalMath" }>;
const CELL_TYPES: ReadonlySet<SpacesToHost["type"]> = new Set(["space.runCell", "space.restartCell", "space.cancelCell", "space.installPython", "space.evalMath"]);
const isCellMessage = (message: SpacesToHost): message is CellMessage => CELL_TYPES.has(message.type);
const isProjectChatMessage = (message: SpacesToHost): message is ProjectChatToHost => message.type.startsWith("projectChat.");

/** The messages the server answers itself, before any action runs. */
type Served = { type: "ready" | "setConversationPresence" | "openProjectChat" | `projectChat.${string}` };
type Action = Exclude<SpacesToHost, Served | { type: `home.${string}` } | CellMessage>;
type Post = (message: HostToSpaces) => void;

// Answers the Spaces page's space.evalMath: runs the prose math in the Space note's session and posts space.mathResult under the request's id.
/** The D2 note key: the cells and the math of one Space note or thread share a session. */
const spaceNoteKey = (spaceId: string, path: string): string => `space:${spaceId}:${path}`;

const UNAVAILABLE: MathResult = { state: "failed", rewrites: [], messages: ["Math is not available here."] };

/** Runs one math request through the host's runner; nothing is written to the note. A failed run still answers, so the page never waits. */
async function evalSpaceMath(
  runMath: ((request: MathRequest, signal?: AbortSignal) => Promise<MathResult>) | undefined,
  post: (message: HostToSpaces) => void,
  spaceId: string,
  msg: { path: string; requestId: string; op: MathOp; tex: string },
): Promise<void> {
  const { path, requestId, op, tex } = msg;
  let result: MathResult;
  if (!runMath) {
    result = UNAVAILABLE;
  } else {
    try {
      result = await runMath({ noteKey: spaceNoteKey(spaceId, path), op, tex });
    } catch (error) {
      result = { ...UNAVAILABLE, messages: [formatError(error)] };
    }
  }
  post({ type: "space.mathResult", requestId, result });
}

/** Runs a cell of an open Space's note or thread, stores its output with the item, posts the items again, then `space.cellState`. */
function runSpaceCell(
  options: ServeSpacesOptions, runs: CellRuns, post: Post, spaceId: string, m: Extract<CellMessage, { type: "space.runCell" }>,
): Promise<void> {
  const { store, runCell, logger } = options;
  const thread = isThreadPath(m.path);
  const { label, code, language, requestId, params, preview } = m;
  return runs.run(runCell, { label, code, language, requestId, noteKey: spaceNoteKey(spaceId, m.path), ...(params ? { params } : {}), ...(preview ? { preview } : {}) }, {
    read: async () => (await (thread ? store.discussions : store.notes).read(spaceId, m.path)).find((item) => item.id === m.itemId)?.body,
    write: (body) => thread ? store.discussions.editMessage(spaceId, m.path, m.itemId, body) : store.notes.editItem(spaceId, m.path, m.itemId, body),
    push: async () => { await postQmd(store, post, spaceId, m.path); await postListOf(store, post, spaceId, m.path, authorOf(options)); },
    post: (state, info) => post({ type: "space.cellState", requestId: m.requestId, state, ...info }),
    preview: (result) => post({ type: "space.cellPreview", requestId: m.requestId, result }),
    fail: (error) => { void logger.log("ERROR", MODULE, "Running a cell failed", { path: m.path, error: formatError(error) }); },
  });
}

async function readReadySpace(store: SpaceStore, id: string) {
  const result = await store.read(id);
  if (result.state === "unreadable") { throw new Error(result.reason); }
  return result;
}

/** Lists notes and topics only when the desk holds one, and reads the listed files on the desk. */
async function readDeskSources(store: SpaceStore, space: Space): Promise<DeskSources> {
  const items = listDeskItems(space).slice(0, SPACE_DESK_LIMIT);
  const [notes, threads] = await Promise.all([
    items.some((item) => item.kind === "note") ? store.notes.list(space.id) : [],
    items.some((item) => item.kind === "thread") ? store.discussions.list(space.id) : [],
  ]);
  const listed = items.filter((item) => (item.kind === "note" ? notes : item.kind === "thread" ? threads : []).some((entry) => entry.path === item.ref));
  const files = await Promise.all(listed.map(async (item) =>
    [item.ref, await (item.kind === "note" ? store.notes : store.discussions).read(space.id, item.ref)] as const));
  return { notes, threads, files: new Map(files) };
}

async function spaceMessage(options: ServeSpacesOptions, id: string): Promise<HostToSpaces> {
  const { store, port, today } = options;
  const [{ space, readOnlyReason: fileReason }, read, projects] = await Promise.all([readReadySpace(store, id), store.readGlossary(id), port.projects()]);
  const readOnlyReason = options.readOnlyReason ?? fileReason;
  const glossary = options.readOnlyReason === undefined ? read : { ...read, readOnlyReason: options.readOnlyReason };
  const library = port.library();
  const sources = await readDeskSources(store, space);
  return {
    type: "space",
    space,
    ...(readOnlyReason !== undefined ? { readOnlyReason } : {}),
    overview: buildOverview(space, library, projects, today(), sources),
    papers: buildPapersTree(space, library),
    glossary: { terms: glossary.glossary.terms, ...(glossary.readOnlyReason !== undefined ? { readOnlyReason: glossary.readOnlyReason } : {}) },
    projects,
    ...(options.runCell ? { canRunCells: true } : {}),
    ...(options.paperObjects ? { hasPaperObjects: true } : {}),
    ...shareFields(port, id),
    author: authorOf(options),
  };
}

function viewMessage(options: ServeSpacesOptions, view: OpenView): Promise<HostToSpaces> {
  if (view.view === "space") { return spaceMessage(options, view.id); }
  if (view.view === "home") { return homeMessage(options); }
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

/** Publishes the page's open conversation; typing is never reported on a read-only Space, which takes no messages. */
async function applyConversationPresence(
  { store, port }: ServeSpacesOptions, message: Extract<SpacesToHost, { type: "setConversationPresence" }>, isOpen: (spaceId: string) => boolean,
): Promise<void> {
  if (!port.setSpacePresence) { return; }
  if (message.path === null) { port.setSpacePresence(message.spaceId, null); return; }
  const read = message.typing ? await store.read(message.spaceId) : undefined;
  // TRAP: the page may have left the Space while the file was read; a late conversation would outlive the clear.
  if (!isOpen(message.spaceId)) { return; }
  const writable = read?.state === "ready" && read.readOnlyReason === undefined;
  port.setSpacePresence(message.spaceId, { path: message.path, typing: message.typing && writable });
}

/** The peers of the open Space, or nothing where the host has no presence. */
function presenceMessage(port: SpacesHostPort, spaceId: string): HostToSpaces | undefined {
  return port.spacePeers ? { type: "spacePresence", spaceId, peers: port.spacePeers(spaceId) } : undefined;
}

async function runAction(options: ServeSpacesOptions, post: Post, message: Action): Promise<void> {
  const { store, port } = options;
  switch (message.type) {
    case "openPaper": return port.openPaper(message.paperId);
    case "selectPaper": return port.selectPaper(message.paperId);
    case "openProject": return port.openProject(message.projectId);
    case "openSpace": return port.openSpace(message.id, message.tab);
    case "openCatalog": return port.openCatalog();
    case "emptyTrash": return store.emptyTrash();
    case "exportIcs": return exportIcs(options, message.id);
    case "shareSpace": case "leaveSpace": case "downloadSpacePapers": return runShareAction(port, message);
    case "listPapers": post({ type: "papers", items: pickablePapers(port) }); return;
    case "listProjects": post({ type: "projects", items: await port.projects() }); return;
    case "createSpace": return port.openSpace(await store.createSpace(message.name));
    case "createSpaceNote": case "createSpaceThread": case "readSpaceQmd": case "addSpaceItem": case "editSpaceItem":
    case "removeSpaceItem": case "setThreadStatus": case "searchDiscussions": return runQmdAction(store, authorOf(options), post, message);
    case "space.noteFile": return answerSpaceNoteFile(options, message, post);
    case "space.paperObjects": return answerSpacePaperObjects(options, message.request, post);
    default: await applySpaceMutation(store, message, authorOf(options));
  }
}

type Fail = (action: string, error: unknown, context: Record<string, unknown>) => void;

/** A cell runs in the Space the page has open; its path is relative to that Space. */
function answerCell(options: ServeSpacesOptions, runs: CellRuns, post: Post, open: OpenView | undefined, message: CellMessage, fail: Fail): void {
  switch (message.type) {
    case "space.cancelCell": runs.cancel(message.requestId); return;
    case "space.installPython": options.installPython?.(); return;
    case "space.evalMath": {
      // A request without an open Space still answers, so the page never waits.
      if (open?.view !== "space") { post({ type: "space.mathResult", requestId: message.requestId, result: { state: "failed", rewrites: [], messages: ["No Space is open."] } }); return; }
      void evalSpaceMath(options.runMath, post, open.id, message);
      return;
    }
    case "space.restartCell": {
      if (open?.view !== "space") { fail(ACTION_LABELS[message.type], new Error("No Space is open."), failureContext(message)); return; }
      const restart = options.restartCell?.(spaceNoteKey(open.id, message.path), message.language);
      restart?.catch((error: unknown) => fail(ACTION_LABELS[message.type], error, failureContext(message)));
      return;
    }
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
  const { port, logger } = options;
  const post: Post = (message) => endpoint.post(message);
  let open: OpenView | undefined;
  let queued = false;
  let tail: Promise<void> = Promise.resolve();
  let presenceTail: Promise<void> = Promise.resolve();
  const runs = createCellRuns();
  const fail = createFail(logger, post);
  let stopped = false;
  const isOpenSpace = (spaceId: string): boolean => !stopped && open?.view === "space" && open.id === spaceId;
  const chats = createSpaceProjectChats({
    port, post, logger,
    isLinked: async (spaceId, projectId) => isOpenSpace(spaceId) && (await readReadySpace(options.store, spaceId)).space.projects.includes(projectId),
  });
  /** Clears this user's conversation and closes the project chat in the Space the page leaves. */
  const leaveSpace = (next: OpenView | undefined): void => {
    if (open?.view === "space" && (next?.view !== "space" || next.id !== open.id)) { port.setSpacePresence?.(open.id, null); chats.close(); }
  };
  // INVARIANT: at most one post waits behind the running one, so changes in one tick post once and a later change still posts.
  const schedule = (): void => {
    if (!open || queued) { return; }
    queued = true;
    tail = tail.then(() => { queued = false; return postView(options, post, fail, open); });
  };

  const stopMessages = endpoint.subscribe((raw) => {
    const message = parseOrWarn(logger, raw);
    if (!message) { return; }
    if (message.type === "ready") { leaveSpace(message); open = message; schedule(); return; }
    if (message.type === "setConversationPresence") {
      // INVARIANT: presence applies in page order, so a typing:false never lands before the typing:true it follows.
      presenceTail = presenceTail.then(() => applyConversationPresence(options, message, isOpenSpace))
        .catch((error: unknown) => fail(ACTION_LABELS[message.type], error, failureContext(message)));
      return;
    }
    if (message.type === "openProjectChat") { chats.open(message.spaceId, message.projectId); return; }
    if (isProjectChatMessage(message)) { chats.receive(message); return; }
    dispatchAction(options, runs, post, open, message, fail);
  });
  const stops = [stopMessages, ...watchChanges(options, schedule, (spaceId) => { if (isOpenSpace(spaceId)) { postPresence(port, post, spaceId); } })];
  return () => {
    for (const stop of stops) { stop(); }
    leaveSpace(undefined);
    chats.close();
    stopped = true;
  };
}

/** Logs the failure and tells the page, with the action's label. */
function createFail(logger: ILogger, post: Post): Fail {
  return (action, error, context) => {
    const reason = formatError(error);
    void logger.log("ERROR", MODULE, `${action} failed`, { ...context, error: reason });
    post({ type: "error", action, message: `${action} failed: ${reason}` });
  };
}

function parseOrWarn(logger: ILogger, raw: unknown): SpacesToHost | undefined {
  const message = parseSpacesMessage(raw);
  if (!message) { void logger.log("WARN", MODULE, "Spaces page message rejected", { type: (raw as { type?: unknown } | null)?.type }); }
  return message;
}

function postPresence(port: SpacesHostPort, post: Post, spaceId: string): void {
  const message = presenceMessage(port, spaceId);
  if (message) { post(message); }
}

/** Posts the view the page has open; a Space also gets its notes, threads and presence. */
async function postView(options: ServeSpacesOptions, post: Post, fail: Fail, view: OpenView | undefined): Promise<void> {
  if (!view) { return; }
  const { store, port } = options;
  try {
    post(await viewMessage(options, view));
    if (view.view === "space") {
      await postNotes(store, post, view.id);
      await postThreads(store, post, view.id, authorOf(options));
      postPresence(port, post, view.id);
    }
  } catch (error) {
    if (view.view === "space") { fail(LOAD_SPACE, error, { id: view.id }); } else { fail(view.view === "home" ? LOAD_HOME : LOAD_CATALOG, error, { view: view.view }); }
  }
}

type Routed = Exclude<SpacesToHost, Served>;

function dispatchAction(options: ServeSpacesOptions, runs: CellRuns, post: Post, open: OpenView | undefined, message: Routed, fail: Fail): void {
  if (isCellMessage(message)) { answerCell(options, runs, post, open, message, fail); return; }
  if (isHomeAction(message)) { runHomeAction(options, message).catch((error: unknown) => fail(HOME_ACTION_LABELS[message.type], error, failureContext(message))); return; }
  runAction(options, post, message).catch((error: unknown) => fail(ACTION_LABELS[message.type], error, failureContext(message)));
}

/** Schedules a post on every change of the store and the host; a peers change only reaches `onPeers`, never the whole view. */
function watchChanges({ store, port, home }: ServeSpacesOptions, schedule: () => void, onPeers: (spaceId: string) => void): (() => void)[] {
  return [store.onChange(schedule), port.onLibraryChange(schedule), port.onProjectsChange(schedule), port.onSpaceShareChange?.(schedule) ?? (() => {}),
    home?.onChange(schedule) ?? (() => {}),
    port.onSpacePeersChange?.(onPeers) ?? (() => {})];
}
