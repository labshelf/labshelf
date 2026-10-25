// Validates a message from the Spaces page before the host acts on it, keeping only the known fields.
import { isNonEmptyString, isJsonObject, isBoolean, isNonEmptyStringList, isOptional, isString } from "../model/json/index.js";
import { SPACE_TABS, type SpaceTab, type SpacesToHost, type SpaceMutation } from "./messages.js";
import { parseDateDraft, parseTermDraft } from "./parseSpaceDrafts.js";

type Fields = Record<string, unknown>;
type ParseOne = (id: string, fields: Fields) => SpaceMutation | undefined;

const isText = (value: unknown): value is string => isString(value) && value.trim() !== "";
const isPaperIds = (value: unknown): value is string[] => isNonEmptyStringList(value) && value.length > 0;

/** `{ [key]: value }`, or nothing when the value is absent. */
const optional = <K extends string>(key: K, value: unknown): Partial<Record<K, string>> =>
  value === undefined ? {} : { [key]: value } as Record<K, string>;

const PARSERS: Record<Exclude<SpaceMutation["type"], "createSpace">, ParseOne> = {
  renameSpace: (id, { name }) => isText(name) ? { type: "renameSpace", id, name } : undefined,
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
  createFolder: (id, { name, parent }) => isText(name) && isOptional(parent, isNonEmptyString)
    ? { type: "createFolder", id, name, ...optional("parent", parent) } : undefined,
  renameFolder: (id, { folderId, name }) =>
    isNonEmptyString(folderId) && isText(name) ? { type: "renameFolder", id, folderId, name } : undefined,
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
  if (!isJsonObject(raw)) { return undefined; }
  const { type, id, name } = raw;
  if (type === "createSpace") { return isText(name) ? { type, name } : undefined; }
  if (!isParsedType(type) || !isNonEmptyString(id)) { return undefined; }
  return PARSERS[type](id, raw);
}

const isTab = (value: unknown): value is SpaceTab => (SPACE_TABS as readonly unknown[]).includes(value);

function parseReady(view: unknown, id: unknown): SpacesToHost | undefined {
  if (view === "catalog") { return { type: "ready", view }; }
  return view === "space" && isNonEmptyString(id) ? { type: "ready", view, id } : undefined;
}

/** The typed message, or undefined when the type is unknown or a field is missing or of the wrong type. */
export function parseSpacesMessage(value: unknown): SpacesToHost | undefined {
  if (!isJsonObject(value)) { return undefined; }
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
    default: return parseSpaceMutation(value);
  }
}
