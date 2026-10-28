// Reads space.json text into a Space without ever throwing: broken files become unreadable, newer versions and wrong-typed keys read-only.
// CONTRACT: documents/contracts/spaces.md#reading-and-writing
import {
  type SpaceReadResult,
  SPACE_DATE_KINDS,
  SPACE_FORMAT_VERSION,
  type SpaceDate,
  type SpaceDateKind,
  type SpaceFolder,
  type SpaceReference,
  type UnknownFields,
} from "./space.js";
import { isCalendarDay } from "../time/index.js";
import { isBoolean, isNonEmptyString, isNonEmptyStringList, isOptional, isRecord, isString } from "../guards/index.js";

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
  if (!isString(title) || !isCalendarDay(date)) { return "title is not text or date is not YYYY-MM-DD"; }
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

// CONTRACT: documents/contracts/spaces.md#reading-and-writing
/** An entry, or the reason it is invalid. */
export type EntryParse<T> = (raw: unknown) => T | string;

export interface ReadEntries<T> {
  readonly valid: T[];
  /** Invalid entries, unchanged, so a write puts them back after the valid ones. */
  readonly raw: unknown[];
}

/** Valid entries in file order; a repeated id keeps its first entry and the repeats are dropped. */
export function readEntries<T extends { id: string }>(
  list: unknown, label: string, parse: EntryParse<T>, warnings: string[],
): ReadEntries<T> {
  const result: ReadEntries<T> = { valid: [], raw: [] };
  // INVARIANT: a list that is not an array makes the file read-only, so reading it as empty never erases it.
  if (!Array.isArray(list)) { return result; }
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    const parsed = parse(entry);
    if (typeof parsed === "string") { warnings.push(`${label}[${index}] kept unread: ${parsed}`); result.raw.push(entry); return; }
    if (seen.has(parsed.id)) { warnings.push(`${label}[${index}] dropped: repeats id ${parsed.id}`); return; }
    seen.add(parsed.id);
    result.valid.push(parsed);
  });
  return result;
}

/** The ids that raw entries still claim, so a new entry never reuses one. */
export function parseEntryIds(raw: readonly unknown[]): string[] {
  return raw.flatMap((entry) => (isRecord(entry) && isNonEmptyString(entry["id"]) ? [entry["id"]] : []));
}

// CONTRACT: documents/contracts/spaces.md#reading-and-writing
const TOP_LEVEL_CHECKS = {
  "space.json": { arrays: ["folders", "papers", "projects", "dates"], strings: ["name", "purpose", "createdAt"] },
  "glossary.json": { arrays: ["terms"], strings: [] },
} as const;

/** A missing version reads as 1. */
export function deriveTopLevelReadOnlyReason(raw: Record<string, unknown>, file: keyof typeof TOP_LEVEL_CHECKS): string | undefined {
  const version = raw["version"];
  if (version !== undefined && typeof version !== "number") {
    return `${file} has a version that is not a number, so it is read-only. Fix version to edit it.`;
  }
  if (typeof version === "number" && version > SPACE_FORMAT_VERSION) {
    return `${file} has version ${version}; this LabShelf writes version 1 only, so the Space is read-only. Update LabShelf to edit it.`;
  }
  const { arrays, strings } = TOP_LEVEL_CHECKS[file];
  const wrong = [
    ...arrays.filter((key) => !isOptional(raw[key], Array.isArray)),
    ...strings.filter((key) => !isOptional(raw[key], isString)),
  ];
  if (wrong.length === 0) { return undefined; }
  return `${file} has ${wrong.join(", ")} of the wrong type, so it is read-only. Fix ${wrong.length === 1 ? "it" : "them"} to edit it.`;
}

// TRAP: plain assignment of "__proto__" sets the prototype, and `in` sees inherited names such as "toString";
// own-property checks and defineProperty keep those keys as ordinary data.
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

export function deriveUnknownFields(raw: Record<string, unknown>, known: readonly string[]): UnknownFields {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) { if (!known.includes(key)) { setOwn(out, key, raw[key]); } }
  return out;
}

/** Drops unset known keys, then appends unknown keys; a known key always wins over an unknown one of the same name. */
export function withUnknownFields(known: Record<string, unknown>, extra: UnknownFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(known)) { if (value !== undefined) { setOwn(out, key, value); } }
  for (const [key, value] of Object.entries(extra)) { if (!Object.hasOwn(known, key)) { setOwn(out, key, value); } }
  return out;
}

// Checks the type of one field read from a synced JSON file.
export const isPage = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;
