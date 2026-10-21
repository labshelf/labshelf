// Validates the folder, paper, project and date entries of space.json, giving the reason for each invalid one.
// CONTRACT: documents/contracts/spaces.md#reading
import { SPACE_DATE_KINDS } from "./types.js";
import type { SpaceDate, SpaceDateKind, SpaceFolder, SpacePaperRef } from "./types.js";
import { isBoolean, isDay, isIdList, isNonEmptyString, isOptional, isRecord, isString, readEntries, unknownKeys } from "./json/index.js";
import type { EntryParse, ReadEntries } from "./json/index.js";

/** Project ids in file order, each once. */
export function readProjectIds(list: unknown, warnings: string[]): ReadEntries<string> {
  const ids = readEntries(list, "projects", (raw) => (isNonEmptyString(raw) ? { id: raw } : "not a project id"), warnings);
  return { valid: ids.valid.map(({ id }) => id), raw: ids.raw };
}

const FOLDER_KEYS = ["id", "name", "parent"];
export const parseFolder: EntryParse<SpaceFolder> = (raw) => {
  if (!isRecord(raw) || !isNonEmptyString(raw["id"])) { return "missing id"; }
  const { id, name, parent } = raw;
  if (!isString(name) || !isOptional(parent, isNonEmptyString)) { return "name or parent has the wrong type"; }
  return { id, name, ...(parent === undefined ? {} : { parent: parent as string }), extra: unknownKeys(raw, FOLDER_KEYS) };
};

const PAPER_KEYS = ["id", "folder", "addedAt", "focus"];
export const parsePaperRef: EntryParse<SpacePaperRef> = (raw) => {
  if (!isRecord(raw) || !isNonEmptyString(raw["id"])) { return "missing id"; }
  const { id, folder, addedAt, focus } = raw;
  if (!isOptional(folder, isNonEmptyString) || !isOptional(addedAt, isString) || !isOptional(focus, isBoolean)) {
    return "folder, addedAt or focus has the wrong type";
  }
  return {
    id, ...(folder === undefined ? {} : { folder: folder as string }), ...(addedAt === undefined ? {} : { addedAt: addedAt as string }),
    focus: focus === true, extra: unknownKeys(raw, PAPER_KEYS),
  };
};

// INVARIANT: every kind's keys are known, so a key of another kind is dropped rather than kept as unknown and
// written back next to a known key of the same name after a kind change.
const DATE_KEYS = ["id", "kind", "title", "date", "done", "paperIds", "projectId"];
const isKind = (value: unknown): value is SpaceDateKind => (SPACE_DATE_KINDS as readonly unknown[]).includes(value);

export const parseDate: EntryParse<SpaceDate> = (raw) => {
  if (!isRecord(raw) || !isNonEmptyString(raw["id"])) { return "missing id"; }
  const { id, kind, title, date, done, paperIds, projectId } = raw;
  if (!isKind(kind)) { return `unknown kind ${JSON.stringify(kind)}`; }
  if (!isString(title) || !isDay(date)) { return "title is not text or date is not YYYY-MM-DD"; }
  const base = { id, title, date, extra: unknownKeys(raw, DATE_KEYS) };
  switch (kind) {
    case "task": return isOptional(done, isBoolean) ? { ...base, kind, done: done === true } : "done is not true or false";
    case "read": return isOptional(paperIds, isIdList) ? { ...base, kind, ...(paperIds === undefined ? {} : { paperIds: paperIds as string[] }) } : "paperIds is not a list of paper ids";
    case "project": return isOptional(projectId, isNonEmptyString) ? { ...base, kind, ...(projectId === undefined ? {} : { projectId: projectId as string }) } : "projectId is not a project id";
    case "deadline": return { ...base, kind };
  }
};
