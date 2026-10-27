// Declares the in-memory shape of a Space and its glossary, and reads their ids and writes their files: space.json, glossary.json and id rules.
// CONTRACT: documents/contracts/spaces.md#layout
import { fillRandom, randomHex } from "../../encoding/index.js";
import { isNonEmptyString, isOptional, isRecord, isString } from "../../guards/index.js";
import {
  deriveTopLevelReadOnlyReason, deriveUnknownFields, isPage, readEntries, withUnknownFields,
} from "./parseSpaceFile.js";

/** The only file version this code writes; a file with a higher version is read-only. */
export const SPACE_FORMAT_VERSION = 1;

export const SPACE_DATE_KINDS = ["task", "read", "project", "deadline"] as const;
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

export interface SpaceReference {
  readonly id: string;
  /** Absent for a paper at the Space root. */
  readonly folder?: string;
  readonly addedAt?: string;
  /** Pinned to the Space overview; only true is written. */
  readonly focus: boolean;
  readonly extra: UnknownFields;
}

interface SpaceDateBase {
  readonly id: string;
  readonly title: string;
  /** YYYY-MM-DD */
  readonly date: string;
  readonly extra: UnknownFields;
}

export interface SpaceTaskDate extends SpaceDateBase { readonly kind: "task"; readonly done: boolean }
export interface SpaceReadDate extends SpaceDateBase { readonly kind: "read"; readonly paperIds?: readonly string[] }
export interface SpaceProjectDate extends SpaceDateBase { readonly kind: "project"; readonly projectId?: string }
export type SpaceDate = SpaceTaskDate | SpaceReadDate | SpaceProjectDate | (SpaceDateBase & { readonly kind: "deadline" });

export interface Space {
  /** The folder name under spaces/; it never changes. */
  readonly id: string;
  readonly name: string;
  readonly purpose?: string;
  readonly createdAt?: string;
  readonly folders: readonly SpaceFolder[];
  readonly papers: readonly SpaceReference[];
  readonly projects: readonly string[];
  readonly dates: readonly SpaceDate[];
  /** Entries this version cannot read, kept unchanged so a write puts them back after the valid entries. */
  readonly invalid: SpaceInvalidEntries;
  readonly extra: UnknownFields;
}

export interface SpaceInvalidEntries {
  readonly folders: readonly unknown[];
  readonly papers: readonly unknown[];
  readonly projects: readonly unknown[];
  readonly dates: readonly unknown[];
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

function dateJson(date: SpaceDate): Record<string, unknown> {
  const known: Record<string, unknown> = { id: date.id, kind: date.kind, title: date.title, date: date.date };
  if (date.kind === "task") { known["done"] = date.done; }
  if (date.kind === "read") { known["paperIds"] = date.paperIds; }
  if (date.kind === "project") { known["projectId"] = date.projectId; }
  return withUnknownFields(known, date.extra);
}

export function serializeSpaceFile(space: Space): string {
  const doc = withUnknownFields({
    version: SPACE_FORMAT_VERSION, name: space.name, purpose: space.purpose, createdAt: space.createdAt,
    folders: [...space.folders.map(folderJson), ...space.invalid.folders],
    papers: [...space.papers.map(paperJson), ...space.invalid.papers],
    projects: [...space.projects, ...space.invalid.projects],
    dates: [...space.dates.map(dateJson), ...space.invalid.dates],
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
