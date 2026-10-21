// Validates a Spaces page message that changes a Space, keeping only the known fields.
import { isBoolean, isIdList, isNonEmptyString, isOptional, isRecord, isString } from "../model/json/index.js";
import type { SpaceMutation } from "./messages.js";
import { parseDateDraft, parseTermDraft } from "./parseSpaceDrafts.js";

type Fields = Record<string, unknown>;
type ParseOne = (id: string, fields: Fields) => SpaceMutation | undefined;

const isText = (value: unknown): value is string => isString(value) && value.trim() !== "";
const isPaperIds = (value: unknown): value is string[] => isIdList(value) && value.length > 0;

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
export function parseSpaceMutation(raw: unknown): SpaceMutation | undefined {
  if (!isRecord(raw)) { return undefined; }
  const { type, id, name } = raw;
  if (type === "createSpace") { return isText(name) ? { type, name } : undefined; }
  if (!isParsedType(type) || !isNonEmptyString(id)) { return undefined; }
  return PARSERS[type](id, raw);
}
