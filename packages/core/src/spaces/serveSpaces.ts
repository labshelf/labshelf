// Serves the Spaces pages from the Space store and a host port: posts the open view after each change and runs the page's actions.
import type { ILogger } from "../ports/index.js";
import {
  parseSpacesMessage,
  type HostToSpaces,
  type PaperPickItem,
  type SpacesEndpoint,
  type SpacesToHost,
  type SpaceMutation,
} from "./protocol/index.js";
import type { SpacesHostPort } from "./spacesHostPort.js";
import type { SpaceStore } from "./store/index.js";
import { buildIcs, buildOverview, buildPapersTree, deriveCatalogRows, resolvePaper } from "./viewModel/index.js";
import { formatError } from "../errors/index.js";

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
  openPaper: "Open paper",
  selectPaper: "Show paper details",
  openProject: "Open project",
  openSpace: "Open Space",
  openCatalog: "Open Spaces",
  exportIcs: "Export calendar",
  listPapers: "List papers",
  listProjects: "List projects",
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

export interface ServeSpacesOptions {
  readonly store: SpaceStore;
  readonly port: SpacesHostPort;
  readonly logger: ILogger;
  /** The local calendar day, YYYY-MM-DD. */
  readonly today: () => string;
}

type OpenView = Extract<SpacesToHost, { type: "ready" }>;
type Action = Exclude<SpacesToHost, { type: "ready" }>;
type Post = (message: HostToSpaces) => void;

async function readReadySpace(store: SpaceStore, id: string) {
  const result = await store.read(id);
  if (result.state === "unreadable") { throw new Error(result.reason); }
  return result;
}

async function spaceMessage({ store, port, today }: ServeSpacesOptions, id: string): Promise<HostToSpaces> {
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
    default: await applySpaceMutation(store, message);
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
    runAction(options, post, message).catch((error: unknown) => fail(ACTION_LABELS[message.type], error, failureContext(message)));
  });
  const stops = [stopMessages, store.onChange(schedule), port.onLibraryChange(schedule), port.onProjectsChange(schedule)];
  return () => { for (const stop of stops) { stop(); } };
}
