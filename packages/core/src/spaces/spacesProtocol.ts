// The Spaces page protocol: the messages between the page and its host, and the parsers that validate page input.
import { isBoolean, isNonBlankString, isNonEmptyString, isNonEmptyStringList, isOptional, isRecord, isString } from "../guards/index.js";
import { isCalendarDay } from "../time/index.js";
import type { MessageEnd } from "../libraryUi/protocol/index.js";
import type { CellRunState } from "../qmd/compute/index.js";
import { isPage } from "./parseSpaceFile.js";
import type { GlossaryTerm, Space } from "./space.js";
import type { SpaceThreadEntry, ThreadStatus } from "./spaceDiscussionsStore.js";
import { isQmdFilePath, type SpaceNoteEntry, type SpaceQmdItem } from "./spaceNotesStore.js";
import type { SpaceDateInput, TermInput } from "./spaceMutations.js";
import type { CatalogRow, PapersTree, ResolvedPaper, SpaceOverview, SpaceProjectEntry } from "./spaceViews.js";

export const SPACE_TABS = ["overview", "papers", "notes", "discussions", "discover", "glossary"] as const;
export type SpaceTab = (typeof SPACE_TABS)[number];

/** One store mutation each; `id` is the Space id. */
export type SpaceMutation =
  | { type: "createSpace"; name: string }
  | { type: "renameSpace"; id: string; name: string }
  /** An absent `purpose` removes it. */
  | { type: "setPurpose"; id: string; purpose?: string }
  | { type: "deleteSpace"; id: string }
  | { type: "addPapers"; id: string; paperIds: string[]; folder?: string }
  | { type: "removePaper"; id: string; paperId: string }
  | { type: "setFocus"; id: string; paperId: string; focus: boolean }
  /** An absent `folder` moves the reference to the Space root. */
  | { type: "moveReference"; id: string; paperId: string; folder?: string }
  | { type: "createFolder"; id: string; name: string; parent?: string }
  | { type: "renameFolder"; id: string; folderId: string; name: string }
  | { type: "deleteFolder"; id: string; folderId: string }
  | { type: "linkProject"; id: string; projectId: string }
  | { type: "unlinkProject"; id: string; projectId: string }
  | { type: "addDate"; id: string; date: SpaceDateInput }
  | { type: "updateDate"; id: string; dateId: string; date: SpaceDateInput }
  | { type: "removeDate"; id: string; dateId: string }
  | { type: "setDone"; id: string; dateId: string; done: boolean }
  | { type: "addTerm"; id: string; term: TermInput }
  | { type: "updateTerm"; id: string; termId: string; term: TermInput }
  | { type: "removeTerm"; id: string; termId: string };

export type SpacesToHost =
  /** The page shows this view; the host posts it now and after every change. */
  | { type: "ready"; view: "catalog" }
  | { type: "ready"; view: "space"; id: string }
  | SpaceMutation
  | { type: "openPaper"; paperId: string }
  /** Shows the paper in the Details surface. */
  | { type: "selectPaper"; paperId: string }
  | { type: "openProject"; projectId: string }
  | { type: "openSpace"; id: string; tab?: SpaceTab }
  | { type: "openCatalog" }
  | { type: "exportIcs"; id: string }
  | { type: "listPapers" }
  | { type: "listProjects" }
  /** Runs one code cell of a note or discussion item; the page makes `requestId` and the host echoes it in `space.cellState`. */
  | { type: "space.runCell"; path: string; itemId: string; label: string; code: string; requestId: string }
  | { type: "space.cancelCell"; requestId: string }
  | { type: "space.installPython" }
  | SpaceQmdAction;

/** Actions on the notes and discussions of a Space; they act on those stores, not on the Space file. Every `path` is relative to the Space folder. */
export type SpaceQmdAction =
  | { type: "createSpaceNote"; spaceId: string; title: string }
  | { type: "createSpaceThread"; spaceId: string; title: string; body: string }
  /** Asks for the items of one file; the host answers with `spaceQmd`. */
  | { type: "readSpaceQmd"; spaceId: string; path: string }
  /** In a thread, the item is a message. */
  | { type: "addSpaceItem"; spaceId: string; path: string; body: string }
  | { type: "editSpaceItem"; spaceId: string; path: string; id: string; body: string }
  | { type: "removeSpaceItem"; spaceId: string; path: string; id: string }
  | { type: "setThreadStatus"; spaceId: string; path: string; status: ThreadStatus };

export type PaperPickItem = Extract<ResolvedPaper, { missing: false }>;

export type HostToSpaces =
  | { type: "catalog"; rows: CatalogRow[] }
  | {
    type: "space";
    space: Space;
    /** Set when the Space must not be changed, with the reason to show. */
    readOnlyReason?: string;
    overview: SpaceOverview;
    papers: PapersTree;
    glossary: { terms: readonly GlossaryTerm[]; readOnlyReason?: string };
    /** Every project the host reports, linked or not. */
    projects: SpaceProjectEntry[];
    /** True only where the host has a cell runner; absent means false. */
    canRunCells?: boolean;
  }
  | { type: "papers"; items: PaperPickItem[] }
  | { type: "projects"; items: SpaceProjectEntry[] }
  | { type: "spaceNotes"; spaceId: string; notes: SpaceNoteEntry[] }
  | { type: "spaceDiscussions"; spaceId: string; threads: SpaceThreadEntry[] }
  /** The items of one note or thread file, in file order. */
  | { type: "spaceQmd"; spaceId: string; path: string; items: SpaceQmdItem[] }
  | { type: "space.cellState"; requestId: string; state: CellRunState }
  /** `action` is the label of the failed action. */
  | { type: "error"; action: string; message: string };

/** The page side of the channel. */
export type SpacesTransport = MessageEnd<SpacesToHost, HostToSpaces>;

/** The host side of the channel. */
export type SpacesEndpoint = MessageEnd<HostToSpaces, SpacesToHost>;

export function parseDateDraft(raw: unknown): SpaceDateInput | undefined {
  if (!isRecord(raw) || !isNonBlankString(raw["title"]) || !isCalendarDay(raw["date"])) { return undefined; }
  const { kind, title, date, done, paperIds, projectId } = raw;
  switch (kind) {
    case "task": return isBoolean(done) ? { kind, title, date, done } : undefined;
    case "deadline": return { kind, title, date };
    case "read":
      if (paperIds === undefined) { return { kind, title, date }; }
      return isNonEmptyStringList(paperIds) ? { kind, title, date, paperIds } : undefined;
    case "project":
      if (projectId === undefined) { return { kind, title, date }; }
      return isNonEmptyString(projectId) ? { kind, title, date, projectId } : undefined;
    default: return undefined;
  }
}

function parseSource(raw: unknown): TermInput["source"] | null {
  if (!isRecord(raw) || !isNonEmptyString(raw["paperId"])) { return null; }
  const { paperId, page } = raw;
  if (page === undefined) { return { paperId }; }
  return isPage(page) ? { paperId, page } : null;
}

export function parseTermDraft(raw: unknown): TermInput | undefined {
  if (!isRecord(raw) || !isNonBlankString(raw["term"]) || !isString(raw["definition"])) { return undefined; }
  const { term, definition, symbol, source } = raw;
  if (symbol !== undefined && !isString(symbol)) { return undefined; }
  const parsedSource = source === undefined ? undefined : parseSource(source);
  if (parsedSource === null) { return undefined; }
  return {
    term, definition,
    ...(symbol === undefined ? {} : { symbol }),
    ...(parsedSource === undefined ? {} : { source: parsedSource }),
  };
}

type Fields = Record<string, unknown>;
type ParseOne = (id: string, fields: Fields) => SpaceMutation | undefined;

const isPaperIds = (value: unknown): value is string[] => isNonEmptyStringList(value) && value.length > 0;

/** `{ [key]: value }`, or nothing when the value is absent. */
const optional = <K extends string>(key: K, value: unknown): Partial<Record<K, string>> =>
  value === undefined ? {} : { [key]: value } as Record<K, string>;

const PARSERS: Record<Exclude<SpaceMutation["type"], "createSpace">, ParseOne> = {
  renameSpace: (id, { name }) => isNonBlankString(name) ? { type: "renameSpace", id, name } : undefined,
  setPurpose: (id, { purpose }) =>
    isOptional(purpose, isString) ? { type: "setPurpose", id, ...optional("purpose", purpose) } : undefined,
  deleteSpace: (id) => ({ type: "deleteSpace", id }),
  addPapers: (id, { paperIds, folder }) => isPaperIds(paperIds) && isOptional(folder, isNonEmptyString)
    ? { type: "addPapers", id, paperIds, ...optional("folder", folder) } : undefined,
  removePaper: (id, { paperId }) => isNonEmptyString(paperId) ? { type: "removePaper", id, paperId } : undefined,
  setFocus: (id, { paperId, focus }) =>
    isNonEmptyString(paperId) && isBoolean(focus) ? { type: "setFocus", id, paperId, focus } : undefined,
  moveReference: (id, { paperId, folder }) => isNonEmptyString(paperId) && isOptional(folder, isNonEmptyString)
    ? { type: "moveReference", id, paperId, ...optional("folder", folder) } : undefined,
  createFolder: (id, { name, parent }) => isNonBlankString(name) && isOptional(parent, isNonEmptyString)
    ? { type: "createFolder", id, name, ...optional("parent", parent) } : undefined,
  renameFolder: (id, { folderId, name }) =>
    isNonEmptyString(folderId) && isNonBlankString(name) ? { type: "renameFolder", id, folderId, name } : undefined,
  deleteFolder: (id, { folderId }) => isNonEmptyString(folderId) ? { type: "deleteFolder", id, folderId } : undefined,
  linkProject: (id, { projectId }) => isNonEmptyString(projectId) ? { type: "linkProject", id, projectId } : undefined,
  unlinkProject: (id, { projectId }) =>
    isNonEmptyString(projectId) ? { type: "unlinkProject", id, projectId } : undefined,
  addDate: (id, fields) => {
    const date = parseDateDraft(fields["date"]);
    return date ? { type: "addDate", id, date } : undefined;
  },
  updateDate: (id, { dateId, date: raw }) => {
    const date = parseDateDraft(raw);
    return date && isNonEmptyString(dateId) ? { type: "updateDate", id, dateId, date } : undefined;
  },
  removeDate: (id, { dateId }) => isNonEmptyString(dateId) ? { type: "removeDate", id, dateId } : undefined,
  setDone: (id, { dateId, done }) =>
    isNonEmptyString(dateId) && isBoolean(done) ? { type: "setDone", id, dateId, done } : undefined,
  addTerm: (id, fields) => {
    const term = parseTermDraft(fields["term"]);
    return term ? { type: "addTerm", id, term } : undefined;
  },
  updateTerm: (id, { termId, term: raw }) => {
    const term = parseTermDraft(raw);
    return term && isNonEmptyString(termId) ? { type: "updateTerm", id, termId, term } : undefined;
  },
  removeTerm: (id, { termId }) => isNonEmptyString(termId) ? { type: "removeTerm", id, termId } : undefined,
};

const isParsedType = (type: unknown): type is keyof typeof PARSERS =>
  isString(type) && Object.prototype.hasOwnProperty.call(PARSERS, type);

/** The mutation, or undefined when the type is not a mutation or a field is missing or of the wrong type. */
function parseSpaceMutation(raw: unknown): SpaceMutation | undefined {
  if (!isRecord(raw)) { return undefined; }
  const { type, id, name } = raw;
  if (type === "createSpace") { return isNonBlankString(name) ? { type, name } : undefined; }
  if (!isParsedType(type) || !isNonEmptyString(id)) { return undefined; }
  return PARSERS[type](id, raw);
}

const isTab = (value: unknown): value is SpaceTab => (SPACE_TABS as readonly unknown[]).includes(value);

function parseReady(view: unknown, id: unknown): SpacesToHost | undefined {
  if (view === "catalog") { return { type: "ready", view }; }
  return view === "space" && isNonEmptyString(id) ? { type: "ready", view, id } : undefined;
}

const isSpaceId = (value: unknown): value is string => isNonEmptyString(value) && !/[/\\]/.test(value) && !value.startsWith(".");

/** INVARIANT: a valid path is `notes/<name>.qmd` or `discussions/<name>.qmd` with one plain, visible name, so it stays inside the Space folder. */
export function isSpaceQmdPath(spaceId: string, path: unknown): path is string {
  return isSpaceId(spaceId) && isQmdFilePath(path);
}

const isThreadStatus = (value: unknown): value is ThreadStatus => value === "open" || value === "resolved";

/** The note or thread action, or undefined when the type is not one or a field or the path is invalid. */
function parseQmdAction(value: Fields): SpaceQmdAction | undefined {
  const { type, spaceId, title, body, path, id, status } = value;
  if (!isSpaceId(spaceId)) { return undefined; }
  switch (type) {
    case "createSpaceNote": return isNonBlankString(title) ? { type, spaceId, title } : undefined;
    case "createSpaceThread": return isNonBlankString(title) && isString(body) ? { type, spaceId, title, body } : undefined;
    default: break;
  }
  if (!isSpaceQmdPath(spaceId, path)) { return undefined; }
  switch (type) {
    case "readSpaceQmd": return { type, spaceId, path };
    case "addSpaceItem": return isString(body) ? { type, spaceId, path, body } : undefined;
    case "editSpaceItem": return isNonEmptyString(id) && isString(body) ? { type, spaceId, path, id, body } : undefined;
    case "removeSpaceItem": return isNonEmptyString(id) ? { type, spaceId, path, id } : undefined;
    case "setThreadStatus": return isThreadStatus(status) ? { type, spaceId, path, status } : undefined;
    default: return undefined;
  }
}

/** The run, cancel or install message, or undefined when the type is not one or a field or the path is invalid. */
function parseCellMessage(value: Fields): SpacesToHost | undefined {
  const { type, path, itemId, label, code, requestId } = value;
  switch (type) {
    case "space.runCell":
      return isQmdFilePath(path) && isNonEmptyString(itemId) && isNonEmptyString(label) && isNonEmptyString(code) && isNonEmptyString(requestId)
        ? { type, path, itemId, label, code, requestId } : undefined;
    case "space.cancelCell": return isNonEmptyString(requestId) ? { type, requestId } : undefined;
    case "space.installPython": return { type };
    default: return undefined;
  }
}

/** The typed message, or undefined when the type is unknown or a field is missing or of the wrong type. */
export function parseSpacesMessage(value: unknown): SpacesToHost | undefined {
  if (!isRecord(value)) { return undefined; }
  const { type, view, id, paperId, projectId, tab } = value;
  switch (type) {
    case "ready": return parseReady(view, id);
    case "openPaper": case "selectPaper": return isNonEmptyString(paperId) ? { type, paperId } : undefined;
    case "openProject": return isNonEmptyString(projectId) ? { type, projectId } : undefined;
    case "openSpace":
      if (!isNonEmptyString(id)) { return undefined; }
      if (tab === undefined) { return { type, id }; }
      return isTab(tab) ? { type, id, tab } : undefined;
    case "openCatalog": case "listPapers": case "listProjects": return { type };
    case "exportIcs": return isNonEmptyString(id) ? { type, id } : undefined;
    case "createSpaceNote": case "createSpaceThread": case "readSpaceQmd": case "addSpaceItem": case "editSpaceItem":
    case "removeSpaceItem": case "setThreadStatus": return parseQmdAction(value);
    case "space.runCell": case "space.cancelCell": case "space.installPython": return parseCellMessage(value);
    default: return parseSpaceMutation(value);
  }
}

