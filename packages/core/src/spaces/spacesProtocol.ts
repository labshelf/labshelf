// The Spaces page protocol: the messages between the page and its host, and the parsers that validate page input.
import { isBoolean, isNonBlankString, isNonEmptyString, isNonEmptyStringList, isOptional, isRecord, isString } from "../guards/index.js";
import { findTablerIcon } from "../ui/icons/index.js";
import type { MessageEnd } from "../libraryUi/protocol/index.js";
import { isCellLanguage, type CellLanguage, type CellRequest, type CellResult, type CellRunState } from "../qmd/compute/index.js";
import { isMathOp, type MathOp, type MathResult } from "../qmd/compute/index.js";
import { readRequestParams } from "../qmd/item/index.js";
import { isNoteFileRequest, type NoteFileReply, type NoteFileRequest } from "../qmd/index.js";
import { parseSourceRef } from "./parseSpaceFile.js";
import { parseDateDraft, parseTermDraft } from "./parseSpaceDrafts.js";
import { isSpaceDeskKind, type GlossaryTerm, type Space, type SpaceDeskKind } from "./space.js";
import type { DiscussionSearchHit, SpaceThreadEntry, ThreadStatus } from "./spaceDiscussionsStore.js";
import { isQmdFilePath, type SpaceNoteEntry, type SpaceQmdItem } from "./spaceNotesStore.js";
import type { AgreementInput, SpaceDateInput, TermInput } from "./spaceMutations.js";
import { parseHomeNote, parseHomePin, parseHomeTaskInput, type HomePin, type HomeTaskInput } from "./homeFile.js";
import type { HomeView } from "./homeView.js";
import type { CatalogRow, PapersTree, ResolvedPaper, SpaceOverview, SpaceProjectEntry } from "./spaceViews.js";
import type { SpacePeer } from "./spacesHostPort.js";

export const SPACE_TABS = ["overview", "papers", "notes", "discussions", "discover", "glossary"] as const;
export type SpaceTab = (typeof SPACE_TABS)[number];

/** One store mutation each; `id` is the Space id. */
export type SpaceMutation =
  | { type: "createSpace"; name: string }
  | { type: "renameSpace"; id: string; name: string }
  /** An absent `purpose` removes it. */
  | { type: "setPurpose"; id: string; purpose?: string }
  /** Deletes the Space folder forever (to the OS trash). */
  | { type: "deleteSpace"; id: string }
  | { type: "setArchived"; id: string; archived: boolean }
  /** `trashed: false` restores the Space to the place it had. */
  | { type: "setTrashed"; id: string; trashed: boolean }
  /** `icon` is a Tabler library name; an absent `icon` clears it back to the layers icon. */
  | { type: "setIcon"; id: string; icon?: string }
  | { type: "addPapers"; id: string; paperIds: string[]; folder?: string }
  | { type: "removePaper"; id: string; paperId: string }
  | { type: "pinToDesk"; id: string; kind: SpaceDeskKind; ref: string }
  | { type: "unpinFromDesk"; id: string; kind: SpaceDeskKind; ref: string }
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
  | { type: "removeTerm"; id: string; termId: string }
  /** Saves a message for the host's author, or removes that author's save of it. */
  | { type: "toggleSaved"; id: string; path: string; itemId: string }
  | { type: "markSeen"; id: string; path: string }
  /** The host stamps the author and the time. */
  | { type: "addAgreement"; id: string; agreement: AgreementInput }
  | { type: "updateAgreement"; id: string; agreementId: string; text: string }
  | { type: "removeAgreement"; id: string; agreementId: string };

/** What the page asks to download of the papers a Space's members share and this library lacks. */
export type SpacePapersDownload =
  | { kind: "paper"; paperId: string }
  /** The folder and its subfolders. */
  | { kind: "folder"; folderId: string }
  | { kind: "space" };

/** Where the open Space stands as a share on this device. */
export interface SpaceShareView {
  readonly shared: boolean;
  /** False while the share has no live connection to its members. */
  readonly connected: boolean;
  /** Why a shared Space cannot sync, to show to the user. */
  readonly problem?: string;
}

export type SpacesToHost =
  /** The page shows this view; the host posts it now and after every change. */
  | { type: "ready"; view: "catalog" }
  | { type: "ready"; view: "space"; id: string }
  | { type: "ready"; view: "home" }
  | HomeAction
  | SpaceMutation
  | { type: "openPaper"; paperId: string }
  /** Shows the paper in the Details surface. */
  | { type: "selectPaper"; paperId: string }
  | { type: "openProject"; projectId: string }
  | { type: "openSpace"; id: string; tab?: SpaceTab }
  | { type: "openCatalog" }
  /** Deletes forever every readable Space in Trash. */
  | { type: "emptyTrash" }
  | { type: "exportIcs"; id: string }
  /** Shares the Space live with others; the host answers through the share state of the next `space`. */
  | { type: "shareSpace"; id: string }
  /** Stops sharing on this device; the Space's files stay. */
  | { type: "leaveSpace"; id: string }
  /** Downloads shared papers this library lacks into a folder the host asks the user to pick. */
  | { type: "downloadSpacePapers"; id: string; what: SpacePapersDownload }
  | { type: "listPapers" }
  | { type: "listProjects" }
  /** Runs one code cell of a note or discussion item; the page makes `requestId` and the host echoes it in `space.cellState`. A `preview` run with `params` is answered with `space.cellPreview` and writes nothing. */
  | { type: "space.runCell"; path: string; itemId: string; label: string; code: string; language: CellLanguage; requestId: string; params?: CellRequest["params"]; preview?: boolean }
  /** Restarts the `language` process of the note or thread at `path`, dropping what its cells defined. */
  | { type: "space.restartCell"; path: string; language: CellLanguage }
  | { type: "space.cancelCell"; requestId: string }
  | { type: "space.installPython" }
  /** Computes or checks one piece of prose math on the Space note's session; the page makes `requestId` and the host echoes it in `space.mathResult`. Nothing is written to the note. */
  | { type: "space.evalMath"; path: string; itemId: string; requestId: string; op: MathOp; tex: string }
  /** Reads, writes or picks a file beside the Space note `path` (a chart's notes/assets/<id>.csv); the host answers with a NoteFileReply. */
  | { type: "space.noteFile"; spaceId: string; path: string; request: NoteFileRequest }
  /** The conversation this user has open in a shared Space (`discussions/<name>.qmd`, null when none) and whether they type in it. */
  | { type: "setConversationPresence"; spaceId: string; path: string | null; typing: boolean }
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
  | { type: "setThreadStatus"; spaceId: string; path: string; status: ThreadStatus }
  /** Searches the messages and titles of every thread and the Space chat; the host answers with `discussionSearch`. */
  | { type: "searchDiscussions"; spaceId: string; query: string };

/** Changes to the personal Home desk; `id` is a desk entry id (`HomeDeskCard.id`). */
export type HomeAction =
  | { type: "home.pin"; item: HomePin; note?: string }
  | { type: "home.unpin"; id: string }
  /** Sets the reminder of a desk entry; an absent note removes it. */
  | { type: "home.setNote"; id: string; note?: string }
  | { type: "home.addTask"; task: HomeTaskInput }
  | { type: "home.completeTask"; id: string };

export type PaperPickItem = Extract<ResolvedPaper, { missing: false }>;

export type HostToSpaces =
  | { type: "catalog"; rows: CatalogRow[] }
  | { type: "home"; home: HomeView }
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
    /** True only where the host can share a Space; absent means false. */
    canShare?: boolean;
    /** True only where the host can download shared papers; absent means false. */
    canDownload?: boolean;
    /** The Space's share on this device; absent where the host cannot share. */
    share?: SpaceShareView;
    /** The name the host stamps on what this user writes, so the page knows its own messages and saves. */
    author?: string;
  }
  | { type: "papers"; items: PaperPickItem[] }
  | { type: "projects"; items: SpaceProjectEntry[] }
  | { type: "spaceNotes"; spaceId: string; notes: SpaceNoteEntry[] }
  | { type: "spaceDiscussions"; spaceId: string; threads: SpaceThreadEntry[] }
  /** The items of one note or thread file, in file order. */
  | { type: "spaceQmd"; spaceId: string; path: string; items: SpaceQmdItem[] }
  /** Answers a `searchDiscussions` with the same query. */
  | { type: "discussionSearch"; spaceId: string; query: string; hits: DiscussionSearchHit[] }
  | { type: "space.cellState"; requestId: string; state: CellRunState; durationMs?: number; warnings?: readonly string[] }
  /** Answers a `space.runCell` with `preview` set: the result of a run that was not stored, with the cell's controls. */
  | { type: "space.cellPreview"; requestId: string; result: CellResult }
  /** Answers a `space.evalMath` with the runner's result; a failed run still answers, with state `failed`. */
  | { type: "space.mathResult"; requestId: string; result: MathResult }
  /** Answers a `space.noteFile` with the same `requestId`. */
  | NoteFileReply
  /** The other members online in the open Space, after its view and after each change; never sent where the host has no presence. */
  | { type: "spacePresence"; spaceId: string; peers: SpacePeer[] }
  /** `action` is the label of the failed action. */
  | { type: "error"; action: string; message: string };

/** The page side of the channel. */
export type SpacesTransport = MessageEnd<SpacesToHost, HostToSpaces>;

/** The host side of the channel. */
export type SpacesEndpoint = MessageEnd<HostToSpaces, SpacesToHost>;

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
  setArchived: (id, { archived }) => isBoolean(archived) ? { type: "setArchived", id, archived } : undefined,
  setTrashed: (id, { trashed }) => isBoolean(trashed) ? { type: "setTrashed", id, trashed } : undefined,
  setIcon: (id, { icon }) => icon === undefined ? { type: "setIcon", id }
    : isString(icon) && findTablerIcon(icon) ? { type: "setIcon", id, icon } : undefined,
  addPapers: (id, { paperIds, folder }) => isPaperIds(paperIds) && isOptional(folder, isNonEmptyString)
    ? { type: "addPapers", id, paperIds, ...optional("folder", folder) } : undefined,
  removePaper: (id, { paperId }) => isNonEmptyString(paperId) ? { type: "removePaper", id, paperId } : undefined,
  pinToDesk: (id, { kind, ref }) => isSpaceDeskKind(kind) && isNonEmptyString(ref) ? { type: "pinToDesk", id, kind, ref } : undefined,
  unpinFromDesk: (id, { kind, ref }) => isSpaceDeskKind(kind) && isNonEmptyString(ref) ? { type: "unpinFromDesk", id, kind, ref } : undefined,
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
  toggleSaved: (id, fields) => {
    const ref = parseSourceRef(fields);
    return ref && isQmdFilePath(ref.path) ? { type: "toggleSaved", id, ...ref } : undefined;
  },
  markSeen: (id, { path }) => isQmdFilePath(path) && path.startsWith("discussions/") ? { type: "markSeen", id, path } : undefined,
  addAgreement: (id, { agreement }) => {
    const ref = parseSourceRef(agreement);
    const text = isRecord(agreement) ? agreement["text"] : undefined;
    return ref && isQmdFilePath(ref.path) && isNonBlankString(text) ? { type: "addAgreement", id, agreement: { ...ref, text } } : undefined;
  },
  updateAgreement: (id, { agreementId, text }) =>
    isNonEmptyString(agreementId) && isNonBlankString(text) ? { type: "updateAgreement", id, agreementId, text } : undefined,
  removeAgreement: (id, { agreementId }) => isNonEmptyString(agreementId) ? { type: "removeAgreement", id, agreementId } : undefined,
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
  if (view === "catalog" || view === "home") { return { type: "ready", view }; }
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
  const { type, spaceId, title, body, path, id, status, query } = value;
  if (!isSpaceId(spaceId)) { return undefined; }
  switch (type) {
    case "searchDiscussions": return isString(query) ? { type, spaceId, query } : undefined;
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

/** The run, restart, cancel or install message, or undefined when the type is not one or a field or the path is invalid. */
function parseCellMessage(value: Fields): SpacesToHost | undefined {
  const { type, path, itemId, label, code, language, requestId, params, preview, op, tex } = value;
  switch (type) {
    case "space.runCell": {
      const parsed = params === undefined ? undefined : readRequestParams(params);
      return isQmdFilePath(path) && isNonEmptyString(itemId) && isNonEmptyString(label) && isNonEmptyString(code)
        && isCellLanguage(language) && isNonEmptyString(requestId)
        && (params === undefined || parsed !== undefined) && (preview === undefined || isBoolean(preview))
        ? { type, path, itemId, label, code, language, requestId, ...(parsed ? { params: parsed } : {}), ...(preview === undefined ? {} : { preview }) } : undefined;
    }
    case "space.restartCell": return isQmdFilePath(path) && isCellLanguage(language) ? { type, path, language } : undefined;
    case "space.cancelCell": return isNonEmptyString(requestId) ? { type, requestId } : undefined;
    case "space.installPython": return { type };
    case "space.evalMath":
      return isQmdFilePath(path) && isNonEmptyString(itemId) && isNonEmptyString(requestId) && isMathOp(op) && isNonEmptyString(tex)
        ? { type, path, itemId, requestId, op, tex } : undefined;
    default: return undefined;
  }
}

/** The download request, or undefined when its kind is unknown or its id is missing. */
function parsePapersDownload(raw: unknown): SpacePapersDownload | undefined {
  if (!isRecord(raw)) { return undefined; }
  const { kind, paperId, folderId } = raw;
  switch (kind) {
    case "paper": return isNonEmptyString(paperId) ? { kind, paperId } : undefined;
    case "folder": return isNonEmptyString(folderId) ? { kind, folderId } : undefined;
    case "space": return { kind };
    default: return undefined;
  }
}

/** The presence message, or undefined when the path is not null nor a discussions path or typing is not a boolean. */
function parseConversationPresence({ spaceId, path, typing }: Fields): SpacesToHost | undefined {
  if (!isSpaceId(spaceId) || !isBoolean(typing)) { return undefined; }
  if (path === null) { return { type: "setConversationPresence", spaceId, path, typing }; }
  return isSpaceQmdPath(spaceId, path) && path.startsWith("discussions/") ? { type: "setConversationPresence", spaceId, path, typing } : undefined;
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
    case "home.pin": {
      const item = parseHomePin(value["item"]);
      const note = parseHomeNote(value["note"]);
      return item ? { type, item, ...(note ? { note } : {}) } : undefined;
    }
    case "home.setNote": {
      if (!isNonEmptyString(id)) { return undefined; }
      const note = parseHomeNote(value["note"]);
      return { type, id, ...(note ? { note } : {}) };
    }
    case "home.addTask": { const task = parseHomeTaskInput(value["task"]); return task ? { type, task } : undefined; }
    case "home.unpin": case "home.completeTask": return isNonEmptyString(id) ? { type, id } : undefined;
    case "openCatalog": case "emptyTrash": case "listPapers": case "listProjects": return { type };
    case "exportIcs": case "shareSpace": case "leaveSpace": return isNonEmptyString(id) ? { type, id } : undefined;
    case "downloadSpacePapers": {
      const what = parsePapersDownload(value["what"]);
      return isNonEmptyString(id) && what ? { type, id, what } : undefined;
    }
    case "createSpaceNote": case "createSpaceThread": case "readSpaceQmd": case "addSpaceItem": case "editSpaceItem":
    case "removeSpaceItem": case "setThreadStatus": case "searchDiscussions": return parseQmdAction(value);
    case "space.runCell": case "space.restartCell": case "space.cancelCell": case "space.installPython": case "space.evalMath": return parseCellMessage(value);
    case "setConversationPresence": return parseConversationPresence(value);
    case "space.noteFile": {
      const { spaceId, path, request } = value;
      return isString(spaceId) && isSpaceQmdPath(spaceId, path) && isNoteFileRequest(request) ? { type, spaceId, path, request } : undefined;
    }
    default: return parseSpaceMutation(value);
  }
}

