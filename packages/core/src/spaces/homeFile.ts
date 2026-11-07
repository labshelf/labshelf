// Declares the personal Home desk (home.json at the library root) and reads, writes and edits it: pins, tasks and the limit of 8.
// CONTRACT: documents/contracts/library-format.md#home-homejson
import { isNonBlankString, isNonEmptyString, isRecord, isString } from "../guards/index.js";
import { isCalendarDay } from "../time/index.js";
import { createEntryId, type UnknownFields } from "./space.js";
import { deriveUnknownFields, withUnknownFields } from "./parseSpaceFile.js";

/** The only file version this code writes; a file with a higher version is read-only. */
const HOME_FORMAT_VERSION = 1;
/** The most entries the desk holds; pinning or adding past it is refused. */
export const HOME_DESK_LIMIT = 8;

const HOME_LINK_KINDS = ["paper", "project", "space"] as const;
export type HomeLinkKind = (typeof HOME_LINK_KINDS)[number];
export interface HomeLink { readonly kind: HomeLinkKind; readonly ref: string }

/** What the user pins: a paper, project or Space by id, or a note or topic of a Space by its path in that Space. */
export type HomePin =
  | { readonly kind: HomeLinkKind; readonly ref: string }
  | { readonly kind: "note" | "thread"; readonly space: string; readonly ref: string };

export interface HomeTaskInput {
  readonly title: string;
  readonly description?: string;
  /** YYYY-MM-DD */
  readonly date?: string;
  readonly link?: HomeLink;
}

export interface HomeTask extends HomeTaskInput { readonly kind: "task"; readonly id: string }

/** `note` is the user's own reminder on the entry, shown on its card. */
export type HomeDeskEntry = (HomePin | HomeTask) & { readonly note?: string; readonly extra: UnknownFields };

export interface HomeFile {
  readonly desk: readonly HomeDeskEntry[];
  /** Entries this version cannot read, kept unchanged so a write puts them back after the valid ones. */
  readonly invalid: readonly unknown[];
  readonly extra: UnknownFields;
  /** Set when the file must not be written, with the reason. */
  readonly readOnlyReason?: string;
}

export const EMPTY_HOME: HomeFile = { desk: [], invalid: [], extra: {} };

/** The id the page unpins by: a task's own id, `kind:ref` for a pin, `kind:space:ref` for a note or topic. */
export function homeEntryId(entry: HomePin | HomeTask): string {
  if (entry.kind === "task") { return entry.id; }
  return entry.kind === "note" || entry.kind === "thread" ? `${entry.kind}:${entry.space}:${entry.ref}` : `${entry.kind}:${entry.ref}`;
}

const isHomeLinkKind = (value: unknown): value is HomeLinkKind => (HOME_LINK_KINDS as readonly unknown[]).includes(value);

function parseHomeLink(raw: unknown): HomeLink | undefined {
  return isRecord(raw) && isHomeLinkKind(raw["kind"]) && isNonEmptyString(raw["ref"]) ? { kind: raw["kind"], ref: raw["ref"] } : undefined;
}

export function parseHomePin(raw: unknown): HomePin | undefined {
  if (!isRecord(raw) || !isNonEmptyString(raw["ref"])) { return undefined; }
  const { kind, ref, space } = raw;
  if (isHomeLinkKind(kind)) { return { kind, ref }; }
  return (kind === "note" || kind === "thread") && isNonEmptyString(space) ? { kind, space, ref } : undefined;
}

/** The task draft, or undefined when the title is blank or a field is of the wrong shape; text is trimmed and blank optionals dropped. */
export function parseHomeTaskInput(raw: unknown): HomeTaskInput | undefined {
  if (!isRecord(raw) || !isNonBlankString(raw["title"])) { return undefined; }
  const { title, description, date, link } = raw;
  if (description !== undefined && !isString(description)) { return undefined; }
  if (date !== undefined && date !== "" && !isCalendarDay(date)) { return undefined; }
  const parsedLink = link === undefined ? undefined : parseHomeLink(link);
  if (link !== undefined && !parsedLink) { return undefined; }
  const text = description?.trim();
  return {
    title: title.trim(),
    ...(text ? { description: text } : {}),
    ...(isCalendarDay(date) ? { date } : {}),
    ...(parsedLink ? { link: parsedLink } : {}),
  };
}

const PIN_KEYS = ["kind", "ref", "space", "note"];
const TASK_KEYS = ["kind", "id", "title", "description", "date", "link", "note"];

/** The trimmed reminder, or undefined when it is absent, blank or not text. */
export function parseHomeNote(raw: unknown): string | undefined {
  return isNonBlankString(raw) ? raw.trim() : undefined;
}

function readEntry(raw: unknown): HomeDeskEntry | undefined {
  if (!isRecord(raw)) { return undefined; }
  if (raw["kind"] === "task") {
    const input = parseHomeTaskInput(raw);
    const note = parseHomeNote(raw["note"]);
    return input && isNonEmptyString(raw["id"]) ? { kind: "task", id: raw["id"], ...input, ...(note ? { note } : {}), extra: deriveUnknownFields(raw, TASK_KEYS) } : undefined;
  }
  const pin = parseHomePin(raw);
  const note = parseHomeNote(raw["note"]);
  return pin ? { ...pin, ...(note ? { note } : {}), extra: deriveUnknownFields(raw, PIN_KEYS) } : undefined;
}

/** Reads the file text; absent text is an empty desk. A newer version or a desk that is not an array reads as read-only. */
export function parseHomeFile(text: string | undefined): HomeFile {
  if (text === undefined) { return EMPTY_HOME; }
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) { throw new Error("home.json is not a JSON object"); }
  const extra = deriveUnknownFields(raw, ["version", "desk"]);
  const version = raw["version"];
  const readOnlyReason = typeof version === "number" && version > HOME_FORMAT_VERSION ? `home.json is from a newer version (${version}).`
    : raw["desk"] !== undefined && !Array.isArray(raw["desk"]) ? "home.json has a desk that is not a list." : undefined;
  const desk: HomeDeskEntry[] = [];
  const invalid: unknown[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw["desk"]) ? raw["desk"] as unknown[] : []) {
    const entry = readEntry(item);
    if (!entry) { invalid.push(item); continue; }
    const id = homeEntryId(entry);
    if (seen.has(id)) { continue; }
    seen.add(id);
    desk.push(entry);
  }
  return { desk, invalid, extra, ...(readOnlyReason ? { readOnlyReason } : {}) };
}

function entryJson(entry: HomeDeskEntry): Record<string, unknown> {
  if (entry.kind === "task") {
    const link = entry.link ? { kind: entry.link.kind, ref: entry.link.ref } : undefined;
    return withUnknownFields({ kind: "task", id: entry.id, title: entry.title, description: entry.description, date: entry.date, link, note: entry.note }, entry.extra);
  }
  const space = entry.kind === "note" || entry.kind === "thread" ? entry.space : undefined;
  return withUnknownFields({ kind: entry.kind, ref: entry.ref, space, note: entry.note }, entry.extra);
}

export function serializeHomeFile(home: HomeFile): string {
  const json = withUnknownFields({ version: HOME_FORMAT_VERSION, desk: [...home.desk.map(entryJson), ...home.invalid] }, home.extra);
  return `${JSON.stringify(json, null, 2)}\n`;
}

function requireRoom(home: HomeFile): void {
  if (home.desk.length + home.invalid.length >= HOME_DESK_LIMIT) { throw new Error(`The desk holds at most ${HOME_DESK_LIMIT} items.`); }
}

/** Appends the pin with its optional reminder; a repeat pin leaves the desk as it is. */
export function withHomePin(home: HomeFile, pin: HomePin, note?: string): HomeFile {
  const id = homeEntryId(pin);
  if (home.desk.some((entry) => homeEntryId(entry) === id)) { return home; }
  requireRoom(home);
  const text = parseHomeNote(note);
  const kept = text ? { note: text } : {};
  const entry: HomeDeskEntry = pin.kind === "note" || pin.kind === "thread"
    ? { kind: pin.kind, space: pin.space, ref: pin.ref, ...kept, extra: {} } : { kind: pin.kind, ref: pin.ref, ...kept, extra: {} };
  return { ...home, desk: [...home.desk, entry] };
}

export function withHomeTask(home: HomeFile, input: HomeTaskInput, fill?: (bytes: Uint8Array<ArrayBuffer>) => void): { home: HomeFile; id: string } {
  requireRoom(home);
  const id = createEntryId(new Set(home.desk.map(homeEntryId)), fill);
  return { home: { ...home, desk: [...home.desk, { kind: "task", id, ...input, extra: {} }] }, id };
}

/** Sets the reminder of the entry with that id; a blank or absent note removes it, and an unknown id leaves the desk as it is. */
export function withHomeNote(home: HomeFile, id: string, note?: string): HomeFile {
  if (!home.desk.some((entry) => homeEntryId(entry) === id)) { return home; }
  const text = parseHomeNote(note);
  return { ...home, desk: home.desk.map((entry) => {
    if (homeEntryId(entry) !== id) { return entry; }
    const { note: _old, ...rest } = entry;
    return (text ? { ...rest, note: text } : rest) as HomeDeskEntry;
  }) };
}

/** Removes the entry with that id; an unknown id leaves the desk as it is. Completing a task removes it the same way. */
export function withoutHomeEntry(home: HomeFile, id: string): HomeFile {
  return { ...home, desk: home.desk.filter((entry) => homeEntryId(entry) !== id) };
}
