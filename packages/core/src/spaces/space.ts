// Declares the in-memory shape of a Space and its glossary, and reads their ids and writes their files: space.json, glossary.json and id rules.
// CONTRACT: documents/contracts/spaces.md#layout
import { fillRandom, randomHex } from "../encoding/index.js";
import { isNonEmptyString, isOptional, isRecord, isString } from "../guards/index.js";
import {
  deriveTopLevelReadOnlyReason, deriveUnknownFields, isPage, readEntries, withUnknownFields,
} from "./parseSpaceFile.js";

/** The only file version this code writes; a file with a higher version is read-only. */
export const SPACE_FORMAT_VERSION = 1;

export const SPACE_DATE_KINDS = ["task", "read", "project", "deadline", "meeting"] as const;
export type SpaceDateKind = (typeof SPACE_DATE_KINDS)[number];

/** Keys this version does not know, kept so a write puts them back after the known keys. */
export type UnknownFields = Readonly<Record<string, unknown>>;

export interface SpaceFolder {
  readonly id: string;
  readonly name: string;
  /** Absent for a folder at the Space root. */
  readonly parent?: string;
  readonly extra: UnknownFields;
}

// CONTRACT: documents/contracts/spaces.md#desk
const SPACE_DESK_KINDS = ["paper", "note", "thread", "project"] as const;
export type SpaceDeskKind = (typeof SPACE_DESK_KINDS)[number];
export const isSpaceDeskKind = (value: unknown): value is SpaceDeskKind => (SPACE_DESK_KINDS as readonly unknown[]).includes(value);
/** The most items the desk shows; pinning more is refused. */
export const SPACE_DESK_LIMIT = 3;

export interface SpaceDeskItem {
  /** `kind:ref`, made on read and never written; a repeat keeps its first entry. */
  readonly id: string;
  readonly kind: SpaceDeskKind;
  /** A paper id, a project id, or a path `notes/<name>.qmd` or `discussions/<name>.qmd`. */
  readonly ref: string;
  readonly extra: UnknownFields;
}

interface SpaceDesk {
  readonly items: readonly SpaceDeskItem[];
  /** Entries this version cannot read, kept unchanged so a write puts them back after the valid ones. */
  readonly invalid: readonly unknown[];
}

/** What a member holding a paper writes into its reference, so members without it can see and download it. */
export interface SpacePaperInfo {
  readonly title: string;
  readonly authors?: readonly string[];
  readonly year?: number;
  readonly doi?: string;
  readonly url?: string;
  readonly pdf?: { readonly sha256: string; readonly bytes: number };
}

// CONTRACT: documents/contracts/collaboration.md#space-papers
/** The reference's `info`, kept among its unknown fields; undefined when absent or of the wrong shape. */
export function readPaperInfo(paper: Pick<SpaceReference, "extra">): SpacePaperInfo | undefined {
  const info = paper.extra["info"];
  if (!isRecord(info) || !isNonEmptyString(info["title"])) { return undefined; }
  const { title, authors, year, doi, url, pdf } = info;
  const sha256 = isRecord(pdf) && isString(pdf["sha256"]) && /^[0-9a-f]{64}$/.test(pdf["sha256"]) ? pdf["sha256"] : undefined;
  const bytes = isRecord(pdf) && Number.isSafeInteger(pdf["bytes"]) && (pdf["bytes"] as number) >= 0 ? pdf["bytes"] as number : undefined;
  return {
    title,
    ...(Array.isArray(authors) && authors.every(isString) ? { authors: authors as string[] } : {}),
    ...(Number.isInteger(year) ? { year: year as number } : {}),
    ...(isNonEmptyString(doi) ? { doi } : {}),
    ...(isNonEmptyString(url) ? { url } : {}),
    ...(sha256 !== undefined && bytes !== undefined ? { pdf: { sha256, bytes } } : {}),
  };
}

export interface SpaceReference {
  readonly id: string;
  /** Absent for a paper at the Space root. */
  readonly folder?: string;
  readonly addedAt?: string;
  /** The desk of a Space without `desk` shows these papers; only true is written. */
  readonly focus: boolean;
  readonly extra: UnknownFields;
}

// CONTRACT: documents/contracts/spaces.md#discussion-records
/** A message of a Space conversation: the thread or chat file and the item id in it. */
export interface SpaceSourceRef { readonly path: string; readonly itemId: string }

interface SpaceDateBase {
  readonly id: string;
  readonly title: string;
  /** YYYY-MM-DD */
  readonly date: string;
  readonly extra: UnknownFields;
}

export interface SpaceTaskDate extends SpaceDateBase {
  readonly kind: "task";
  readonly done: boolean;
  readonly assignee?: string;
  /** The message the task was made from. */
  readonly source?: SpaceSourceRef;
}
export interface SpaceReadDate extends SpaceDateBase { readonly kind: "read"; readonly paperIds?: readonly string[] }
export interface SpaceProjectDate extends SpaceDateBase { readonly kind: "project"; readonly projectId?: string }
export interface SpaceMeetingDate extends SpaceDateBase {
  readonly kind: "meeting";
  /** HH:MM local time; a meeting without `start` lasts the whole day. */
  readonly start?: string;
  readonly end?: string;
  readonly participants?: readonly string[];
  readonly agenda?: string;
  readonly source?: SpaceSourceRef;
}
export type SpaceDate = SpaceTaskDate | SpaceReadDate | SpaceProjectDate | SpaceMeetingDate | (SpaceDateBase & { readonly kind: "deadline" });

/** A message one member bookmarked; `by` is the author name the host stamps. */
export interface SpaceSavedMessage extends SpaceSourceRef { readonly id: string; readonly by: string; readonly created: string; readonly extra: UnknownFields }

/** When `by` last opened the conversation at `path`; one entry per person and conversation, its id derived from both (seenEntryId). */
export interface SpaceSeen { readonly id: string; readonly path: string; readonly by: string; readonly at: string; readonly extra: UnknownFields }

/** What the Space agreed on, with the message it came from. */
export interface SpaceAgreement extends SpaceSourceRef {
  readonly id: string;
  readonly text: string;
  readonly by: string;
  readonly created: string;
  readonly extra: UnknownFields;
}

export interface Space {
  /** The folder name under spaces/; it never changes. */
  readonly id: string;
  readonly name: string;
  readonly purpose?: string;
  /** A Tabler library icon name shown in place of the layers icon; an unknown name is dropped on read. */
  readonly icon?: string;
  readonly createdAt?: string;
  /** Set only as true; the Space sits in Archived unless it is also trashed. */
  readonly archived?: true;
  /** ISO time the Space was moved to Trash; absent when it is not in Trash. */
  readonly trashedAt?: string;
  /** The id of the share this copy of the Space belongs to; per user, like `desk`. */
  readonly shared?: string;
  readonly folders: readonly SpaceFolder[];
  readonly papers: readonly SpaceReference[];
  readonly projects: readonly string[];
  readonly dates: readonly SpaceDate[];
  /** Absent until the desk is first changed; the desk then shows the papers in focus. */
  readonly desk?: SpaceDesk;
  /** Absent until a message is first saved. */
  readonly saved?: readonly SpaceSavedMessage[];
  /** Absent until an agreement is first recorded. */
  readonly agreements?: readonly SpaceAgreement[];
  /** Absent until someone first opens a conversation. */
  readonly seen?: readonly SpaceSeen[];
  /** Entries this version cannot read, kept unchanged so a write puts them back after the valid entries. */
  readonly invalid: SpaceInvalidEntries;
  readonly extra: UnknownFields;
}

/** The desk entries in file order; a Space without `desk` reads the papers in focus, at most SPACE_DESK_LIMIT of them. */
export function listDeskItems(space: Pick<Space, "desk" | "papers">): readonly SpaceDeskItem[] {
  if (space.desk) { return space.desk.items; }
  return space.papers.filter((paper) => paper.focus).slice(0, SPACE_DESK_LIMIT)
    .map((paper) => ({ id: `paper:${paper.id}`, kind: "paper" as const, ref: paper.id, extra: {} }));
}

/** Where a Space is listed: Trash wins over Archived, and trashing keeps `archived` so Restore returns it to Archived. */
export type SpacePlace = "spaces" | "archived" | "trash";

export function placeOfSpace(space: Pick<Space, "archived" | "trashedAt">): SpacePlace {
  if (space.trashedAt !== undefined) { return "trash"; }
  return space.archived ? "archived" : "spaces";
}

export interface SpaceInvalidEntries {
  readonly folders: readonly unknown[];
  readonly papers: readonly unknown[];
  readonly projects: readonly unknown[];
  readonly dates: readonly unknown[];
  readonly saved?: readonly unknown[];
  readonly agreements?: readonly unknown[];
  readonly seen?: readonly unknown[];
}

/** What reading one space.json gives; P is the host's path type. */
export type SpaceReadResult<P = string> =
  | {
    readonly state: "ready";
    readonly path: P;
    readonly space: Space;
    /** One line per dropped or repaired entry, for the caller to log once per read. */
    readonly warnings: readonly string[];
    /** Set when the file must not be written, with the reason the apps show. */
    readonly readOnlyReason?: string;
  }
  | { readonly state: "unreadable"; readonly id: string; readonly path: P; readonly reason: string };

export interface GlossarySource {
  readonly paperId: string;
  readonly page?: number;
  readonly extra: UnknownFields;
}

export interface GlossaryTerm {
  readonly id: string;
  readonly term: string;
  readonly symbol?: string;
  readonly definition: string;
  readonly source?: GlossarySource;
  readonly extra: UnknownFields;
}

export interface Glossary {
  readonly terms: readonly GlossaryTerm[];
  /** Terms this version cannot read, kept unchanged so a write puts them back after the valid terms. */
  readonly invalidTerms: readonly unknown[];
  readonly extra: UnknownFields;
}

export interface GlossaryReadResult {
  readonly glossary: Glossary;
  readonly warnings: readonly string[];
  /** Set when the file must not be written: a higher version, or content that could not be parsed. */
  readonly readOnlyReason?: string;
}

// CONTRACT: documents/contracts/spaces.md#ids
const MAX_SPACE_ID_LENGTH = 48;
const EMPTY_SPACE_ID = "space";

function slug(name: string, maxLength: number): string {
  const folded = name.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
  const dashed = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return dashed.slice(0, maxLength).replace(/-+$/, "");
}

/** The id for a Space named `name`; `existing` holds the folder names already in spaces/. */
export function deriveSpaceId(name: string, existing: ReadonlySet<string>): string {
  const base = slug(name, MAX_SPACE_ID_LENGTH) || EMPTY_SPACE_ID;
  if (!existing.has(base)) { return base; }
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_SPACE_ID_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!existing.has(candidate)) { return candidate; }
  }
}

type FillRandom = (bytes: Uint8Array<ArrayBuffer>) => void;

/** A random 8-hex-character id not in `existing`; `fill` is injectable so tests can force a collision. */
export function createEntryId(existing: ReadonlySet<string>, fill: FillRandom = fillRandom): string {
  for (;;) {
    const id = randomHex(4, (bytes) => { fill(bytes); return bytes; });
    if (!existing.has(id)) { return id; }
  }
}

// CONTRACT: documents/contracts/spaces.md#reading-and-writing
const folderJson = (folder: SpaceFolder) => withUnknownFields({ id: folder.id, name: folder.name, parent: folder.parent }, folder.extra);

const paperJson = (paper: SpaceReference) => withUnknownFields(
  { id: paper.id, folder: paper.folder, addedAt: paper.addedAt, focus: paper.focus ? true : undefined }, paper.extra,
);

const sourceRefJson = (ref: SpaceSourceRef | undefined) => (ref === undefined ? undefined : { path: ref.path, itemId: ref.itemId });

function dateJson(date: SpaceDate): Record<string, unknown> {
  const known: Record<string, unknown> = { id: date.id, kind: date.kind, title: date.title, date: date.date };
  if (date.kind === "task") { Object.assign(known, { done: date.done, assignee: date.assignee, source: sourceRefJson(date.source) }); }
  if (date.kind === "meeting") {
    Object.assign(known, { start: date.start, end: date.end, participants: date.participants, agenda: date.agenda, source: sourceRefJson(date.source) });
  }
  if (date.kind === "read") { known["paperIds"] = date.paperIds; }
  if (date.kind === "project") { known["projectId"] = date.projectId; }
  return withUnknownFields(known, date.extra);
}

const deskJson = (item: SpaceDeskItem) => withUnknownFields({ kind: item.kind, ref: item.ref }, item.extra);

const savedJson = (saved: SpaceSavedMessage) =>
  withUnknownFields({ id: saved.id, path: saved.path, itemId: saved.itemId, by: saved.by, created: saved.created }, saved.extra);

const agreementJson = (agreement: SpaceAgreement) => withUnknownFields({
  id: agreement.id, text: agreement.text, path: agreement.path, itemId: agreement.itemId, by: agreement.by, created: agreement.created,
}, agreement.extra);

const seenJson = (seen: SpaceSeen) => withUnknownFields({ id: seen.id, path: seen.path, by: seen.by, at: seen.at }, seen.extra);

/** A list written only once the Space has it, so older files read and write back unchanged. */
function optionalList<T>(valid: readonly T[] | undefined, invalid: readonly unknown[] | undefined, json: (entry: T) => unknown): unknown[] | undefined {
  return valid === undefined && invalid === undefined ? undefined : [...(valid ?? []).map(json), ...(invalid ?? [])];
}

export function serializeSpaceFile(space: Space): string {
  const doc = withUnknownFields({
    version: SPACE_FORMAT_VERSION, name: space.name, purpose: space.purpose, icon: space.icon, createdAt: space.createdAt,
    archived: space.archived ? true : undefined, trashedAt: space.trashedAt, shared: space.shared,
    folders: [...space.folders.map(folderJson), ...space.invalid.folders],
    papers: [...space.papers.map(paperJson), ...space.invalid.papers],
    projects: [...space.projects, ...space.invalid.projects],
    dates: [...space.dates.map(dateJson), ...space.invalid.dates],
    desk: space.desk === undefined ? undefined : [...space.desk.items.map(deskJson), ...space.desk.invalid],
    saved: optionalList(space.saved, space.invalid.saved, savedJson),
    agreements: optionalList(space.agreements, space.invalid.agreements, agreementJson),
    seen: optionalList(space.seen, space.invalid.seen, seenJson),
  }, space.extra);
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// CONTRACT: documents/contracts/spaces.md#layout
const EMPTY: Glossary = { terms: [], invalidTerms: [], extra: {} };
const GLOSSARY_KEYS = ["version", "terms"];
const TERM_KEYS = ["id", "term", "symbol", "definition", "source"];
const SOURCE_KEYS = ["paperId", "page"];

function parseSource(raw: unknown): GlossarySource | undefined {
  if (!isRecord(raw) || !isNonEmptyString(raw["paperId"]) || !isOptional(raw["page"], isPage)) { return undefined; }
  const page = raw["page"] as number | undefined;
  return { paperId: raw["paperId"], ...(page === undefined ? {} : { page }), extra: deriveUnknownFields(raw, SOURCE_KEYS) };
}

function parseTerm(raw: unknown): GlossaryTerm | string {
  if (!isRecord(raw) || !isNonEmptyString(raw["id"])) { return "missing id"; }
  const { id, term, symbol, definition } = raw;
  if (!isString(term) || !isString(definition) || !isOptional(symbol, isString)) { return "term, definition or symbol is not text"; }
  const source = raw["source"] === undefined ? undefined : parseSource(raw["source"]);
  if (raw["source"] !== undefined && source === undefined) { return "source needs a paperId and an optional page number"; }
  return {
    id, term, ...(symbol === undefined ? {} : { symbol: symbol as string }), definition,
    ...(source === undefined ? {} : { source }), extra: deriveUnknownFields(raw, TERM_KEYS),
  };
}

/** `text` is undefined when the file does not exist, which is an empty glossary. */
export function parseGlossaryFile(text: string | undefined): GlossaryReadResult {
  if (text === undefined) { return { glossary: EMPTY, warnings: [] }; }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { glossary: EMPTY, warnings: [], readOnlyReason: `glossary.json is not valid JSON (${(error as Error).message}); fix it to edit the glossary.` };
  }
  if (!isRecord(raw)) { return { glossary: EMPTY, warnings: [], readOnlyReason: "glossary.json is not a JSON object; fix it to edit the glossary." }; }
  const warnings: string[] = [];
  const terms = readEntries(raw["terms"], "terms", parseTerm, warnings);
  const glossary = { terms: terms.valid, invalidTerms: terms.raw, extra: deriveUnknownFields(raw, GLOSSARY_KEYS) };
  const readOnlyReason = deriveTopLevelReadOnlyReason(raw, "glossary.json");
  return { glossary, warnings, ...(readOnlyReason === undefined ? {} : { readOnlyReason }) };
}

const sourceJson = (source: GlossarySource) => withUnknownFields({ paperId: source.paperId, page: source.page }, source.extra);

const termJson = (term: GlossaryTerm) => withUnknownFields({
  id: term.id, term: term.term, symbol: term.symbol, definition: term.definition,
  source: term.source === undefined ? undefined : sourceJson(term.source),
}, term.extra);

export function serializeGlossaryFile(glossary: Glossary): string {
  const doc = withUnknownFields({ version: SPACE_FORMAT_VERSION, terms: [...glossary.terms.map(termJson), ...glossary.invalidTerms] }, glossary.extra);
  return `${JSON.stringify(doc, null, 2)}\n`;
}
