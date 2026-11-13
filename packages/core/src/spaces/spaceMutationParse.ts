// The store mutations the Spaces page sends and the parser that validates each one from untrusted page input.
import { isBoolean, isNonBlankString, isNonEmptyString, isNonEmptyStringList, isOptional, isRecord, isString } from "../guards/index.js";
import { findTablerIcon } from "../ui/icons/index.js";
import { parseSourceRef } from "./parseSpaceFile.js";
import { parseDateDraft, parseTermDraft } from "./parseSpaceDrafts.js";
import { isSpaceDeskKind, type SpaceDeskKind } from "./space.js";
import { isQmdFilePath } from "./spaceNotesStore.js";
import type { AgreementInput, SpaceDateInput, TermInput } from "./spaceMutations.js";

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

export type Fields = Record<string, unknown>;
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
export function parseSpaceMutation(raw: unknown): SpaceMutation | undefined {
  if (!isRecord(raw)) { return undefined; }
  const { type, id, name } = raw;
  if (type === "createSpace") { return isNonBlankString(name) ? { type, name } : undefined; }
  if (!isParsedType(type) || !isNonEmptyString(id)) { return undefined; }
  return PARSERS[type](id, raw);
}
