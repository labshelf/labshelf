// Reads space.json text into a Space without ever throwing: broken files become unreadable, newer versions and wrong-typed keys read-only.
// CONTRACT: documents/contracts/spaces.md#reading-and-writing
import {
  type SpaceReadResult,
  SPACE_DATE_KINDS,
  type SpaceDate,
  type SpaceDateKind,
  type SpaceFolder,
  type SpaceReference,
} from "./space.js";
import {
  readEntries,
  deriveTopLevelReadOnlyReason,
  deriveUnknownFields,
  isDay,
  type EntryParse,
  type ReadEntries,
} from "./json/index.js";
import { isBoolean, isNonEmptyString, isNonEmptyStringList, isOptional, isRecord, isString } from "../../guards/index.js";

function withoutKey<T extends object, K extends keyof T>(entry: T, key: K): T {
  const { [key]: _dropped, ...rest } = entry;
  return rest as T;
}

/** Ids of folders whose parent chain loops back on itself. */
function foldersOnCycles(parentOf: ReadonlyMap<string, string | undefined>): Set<string> {
  const onCycle = new Set<string>();
  for (const start of parentOf.keys()) {
    const path: string[] = [];
    let current: string | undefined = start;
    while (current !== undefined && !path.includes(current) && !onCycle.has(current)) {
      path.push(current);
      current = parentOf.get(current);
    }
    if (current !== undefined && path.includes(current)) {
      path.slice(path.indexOf(current)).forEach((id) => onCycle.add(id));
    }
  }
  return onCycle;
}

function resolveSpaceReferences(
  folders: readonly SpaceFolder[], papers: readonly SpaceReference[], warnings: string[],
): { folders: SpaceFolder[]; papers: SpaceReference[] } {
  const ids = new Set(folders.map((folder) => folder.id));
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parent !== undefined && ids.has(folder.parent) ? folder.parent : undefined]));
  const onCycle = foldersOnCycles(parentOf);
  const resolvedFolders = folders.map((folder) => {
    if (folder.parent === undefined) { return folder; }
    if (!ids.has(folder.parent)) { warnings.push(`folder ${folder.id}: parent ${folder.parent} is missing, read as root`); }
    else if (onCycle.has(folder.id)) { warnings.push(`folder ${folder.id}: on a parent cycle, read as root`); }
    else { return folder; }
    return withoutKey(folder, "parent");
  });
  const resolvedPapers = papers.map((paper) => {
    if (paper.folder === undefined || ids.has(paper.folder)) { return paper; }
    warnings.push(`paper ${paper.id}: folder ${paper.folder} is missing, read as root`);
    return withoutKey(paper, "folder");
  });
  return { folders: resolvedFolders, papers: resolvedPapers };
}

/** Project ids in file order, each once. */
function readProjectIds(list: unknown, warnings: string[]): ReadEntries<string> {
  const ids = readEntries(list, "projects", (raw) => (isNonEmptyString(raw) ? { id: raw } : "not a project id"), warnings);
  return { valid: ids.valid.map(({ id }) => id), raw: ids.raw };
}

const FOLDER_KEYS = ["id", "name", "parent"];
const parseFolder: EntryParse<SpaceFolder> = (raw) => {
  if (!isRecord(raw) || !isNonEmptyString(raw["id"])) { return "missing id"; }
  const { id, name, parent } = raw;
  if (!isString(name) || !isOptional(parent, isNonEmptyString)) { return "name or parent has the wrong type"; }
  return { id, name, ...(parent === undefined ? {} : { parent: parent as string }), extra: deriveUnknownFields(raw, FOLDER_KEYS) };
};

const PAPER_KEYS = ["id", "folder", "addedAt", "focus"];
const parsePaperRef: EntryParse<SpaceReference> = (raw) => {
  if (!isRecord(raw) || !isNonEmptyString(raw["id"])) { return "missing id"; }
  const { id, folder, addedAt, focus } = raw;
  if (!isOptional(folder, isNonEmptyString) || !isOptional(addedAt, isString) || !isOptional(focus, isBoolean)) {
    return "folder, addedAt or focus has the wrong type";
  }
  return {
    id, ...(folder === undefined ? {} : { folder: folder as string }), ...(addedAt === undefined ? {} : { addedAt: addedAt as string }),
    focus: focus === true, extra: deriveUnknownFields(raw, PAPER_KEYS),
  };
};

// INVARIANT: every kind's keys are known, so a key of another kind is dropped rather than kept as unknown and
// written back next to a known key of the same name after a kind change.
const DATE_KEYS = ["id", "kind", "title", "date", "done", "paperIds", "projectId"];
const isKind = (value: unknown): value is SpaceDateKind => (SPACE_DATE_KINDS as readonly unknown[]).includes(value);

const parseDate: EntryParse<SpaceDate> = (raw) => {
  if (!isRecord(raw) || !isNonEmptyString(raw["id"])) { return "missing id"; }
  const { id, kind, title, date, done, paperIds, projectId } = raw;
  if (!isKind(kind)) { return `unknown kind ${JSON.stringify(kind)}`; }
  if (!isString(title) || !isDay(date)) { return "title is not text or date is not YYYY-MM-DD"; }
  const base = { id, title, date, extra: deriveUnknownFields(raw, DATE_KEYS) };
  switch (kind) {
    case "task": return isOptional(done, isBoolean) ? { ...base, kind, done: done === true } : "done is not true or false";
    case "read": return isOptional(paperIds, isNonEmptyStringList) ? { ...base, kind, ...(paperIds === undefined ? {} : { paperIds: paperIds as string[] }) } : "paperIds is not a list of paper ids";
    case "project": return isOptional(projectId, isNonEmptyString) ? { ...base, kind, ...(projectId === undefined ? {} : { projectId: projectId as string }) } : "projectId is not a project id";
    case "deadline": return { ...base, kind };
  }
};

const SPACE_KEYS = ["version", "name", "purpose", "createdAt", "folders", "papers", "projects", "dates"];

/** `where.id` is the Space's folder name; `where.path` is echoed back so the caller can show and fix the file. */
export function parseSpaceFile<P>(text: string, where: { readonly id: string; readonly path: P }): SpaceReadResult<P> {
  const { id, path } = where;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { state: "unreadable", id, path, reason: `space.json is not valid JSON: ${(error as Error).message}` };
  }
  if (!isRecord(raw)) { return { state: "unreadable", id, path, reason: "space.json is not a JSON object" }; }

  const warnings: string[] = [];
  const { name, purpose, createdAt } = raw;
  const folders = readEntries(raw["folders"], "folders", parseFolder, warnings);
  const papers = readEntries(raw["papers"], "papers", parsePaperRef, warnings);
  const projects = readProjectIds(raw["projects"], warnings);
  const dates = readEntries(raw["dates"], "dates", parseDate, warnings);
  const space = {
    id, name: isNonEmptyString(name) ? name : id,
    ...(isString(purpose) ? { purpose } : {}), ...(isString(createdAt) ? { createdAt } : {}),
    ...resolveSpaceReferences(folders.valid, papers.valid, warnings),
    projects: projects.valid,
    dates: dates.valid,
    invalid: { folders: folders.raw, papers: papers.raw, projects: projects.raw, dates: dates.raw },
    extra: deriveUnknownFields(raw, SPACE_KEYS),
  };
  const readOnlyReason = deriveTopLevelReadOnlyReason(raw, "space.json");
  return { state: "ready", path, space, warnings, ...(readOnlyReason === undefined ? {} : { readOnlyReason }) };
}
