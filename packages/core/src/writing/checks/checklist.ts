/** A project's Checklist model: its section placement, the grouped checklist and the hand-added items in .labshelf/checklist.json. */
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf
import type { ReadingStatus } from "../../library/index.js";
import { isRecord, isTimestamp } from "../../guards/index.js";
import { parseJsonObject } from "../../json/index.js";
import type { ProjectFormat } from "../project/index.js";
import type { TodoItem } from "./todoMarkers.js";
import { findCitationSites, findSourceHeadings, type SourceHeading } from "../citations/index.js";

// --- Checklist file ---

export const CHECKLIST_DIR = ".labshelf";
export const CHECKLIST_FILE = "checklist.json";

/** The By kind groups a manual item can sit in; an item without one sits in My items. */
export const MANUAL_ITEM_GROUPS = ["todo", "ref", "figure", "pages", "reading"] as const;
export type ManualItemKind = (typeof MANUAL_ITEM_GROUPS)[number];

/** An item a user added to a project's Checklist by hand. */
export interface ManualItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
  group?: ManualItemKind;
  /** The By section group id the item sits in; absent in By kind items. */
  section?: string;
}

/** The whole file: invalid items and unknown keys are carried so a rewrite loses nothing. */
export interface ChecklistDocument {
  [key: string]: unknown;
  items: readonly unknown[];
}

/** @returns undefined when the text is not a JSON object with an `items` array */
export function parseChecklistFile(text: string): ChecklistDocument | undefined {
  const raw = parseJsonObject(text);
  if (raw === undefined || !Array.isArray(raw["items"])) { return undefined; }
  return raw as ChecklistDocument;
}

export function serializeChecklistFile(doc: ChecklistDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// The file syncs from other machines, so every key is checked; doneAt must be present exactly when done is true.
function isManualItem(value: unknown): value is ManualItem {
  if (!isRecord(value)) { return false; }
  const { id, text, done, createdAt, doneAt } = value;
  if (typeof id !== "string" || id === "" || typeof text !== "string" || text === "") { return false; }
  if (typeof done !== "boolean" || !isTimestamp(createdAt)) { return false; }
  return done ? isTimestamp(doneAt) : doneAt === undefined;
}

const isGroup = (value: unknown): value is ManualItemKind => (MANUAL_ITEM_GROUPS as readonly unknown[]).includes(value);

const MAX_SECTION_LENGTH = 200;
const isSection = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= MAX_SECTION_LENGTH;

/** @returns the valid items in file order; a group or section this version cannot read is left out */
export function listManualItems(doc: ChecklistDocument): ManualItem[] {
  return doc.items.filter(isManualItem).map(({ id, text, done, createdAt, doneAt, group, section }) => ({
    id, text, done, createdAt, ...(doneAt === undefined ? {} : { doneAt }), ...(isGroup(group) ? { group } : {}), ...(isSection(section) ? { section } : {}),
  }));
}

/** A group places the item in By kind, a section in By section; neither leaves it in My items and Whole project. */
export function addManualItem(
  doc: ChecklistDocument, entry: { id: string; text: string; now: string; group?: ManualItemKind; section?: string },
): ChecklistDocument {
  const item: ManualItem = {
    id: entry.id, text: entry.text, done: false, createdAt: entry.now,
    ...(entry.group ? { group: entry.group } : {}), ...(entry.section ? { section: entry.section } : {}),
  };
  return { ...doc, items: [...doc.items, item] };
}

/** An unknown id returns the document unchanged. */
export function setManualItemDone(doc: ChecklistDocument, id: string, done: boolean, now: string): ChecklistDocument {
  return {
    ...doc,
    items: doc.items.map((item) => {
      if (!isManualItem(item) || item.id !== id) { return item; }
      const { doneAt: _doneAt, ...rest } = item as ManualItem & Record<string, unknown>;
      return done ? { ...rest, done, doneAt: now } : { ...rest, done };
    }),
  };
}

/** An unknown id returns the document unchanged. */
export function removeManualItem(doc: ChecklistDocument, id: string): ChecklistDocument {
  return { ...doc, items: doc.items.filter((item) => !isManualItem(item) || item.id !== id) };
}

// --- Section placement ---

export interface ChecklistSource {
  /** Project-root-relative posix path. */
  path: string;
  format: ProjectFormat;
  text: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  file: string;
  /** Zero-based line of the heading; undefined for a file's own node. */
  line?: number;
}

export type SectionPlacer = (file: string, line: number) => ChecklistSection;

const fileNode = (file: string): ChecklistSection => ({ id: file, title: file, file });

/** Items of the main file go under the nearest heading at or above them; items of an included file go under that file (D14). */
export function createSectionPlacer(sources: readonly ChecklistSource[], mainPath: string): SectionPlacer {
  const main = sources.find((source) => source.path === mainPath);
  const headings: SourceHeading[] = main ? findSourceHeadings(main.format, main.text) : [];
  return (file, line) => {
    if (file !== mainPath) { return fileNode(file); }
    // INVARIANT: headings are in text order, so the last one at or above the line is the nearest.
    const heading = headings.filter((candidate) => candidate.line <= line).at(-1);
    return heading ? { id: `${file}:${heading.line}`, title: heading.title, file, line: heading.line } : fileNode(file);
  };
}

/** For each cited key, the distinct sections citing it, in source order. */
export function deriveCitationSections(sources: readonly ChecklistSource[], mainPath: string): Map<string, ChecklistSection[]> {
  const place = createSectionPlacer(sources, mainPath);
  const index = new Map<string, ChecklistSection[]>();
  for (const source of sources) {
    for (const site of findCitationSites(source.format, source.text)) {
      const section = place(source.path, site.line);
      const sections = index.get(site.key) ?? [];
      if (!sections.some((known) => known.id === section.id)) { sections.push(section); }
      index.set(site.key, sections);
    }
  }
  return index;
}

// --- Grouped checklist ---

export interface BrokenReference { file: string; line: number; ref: string }
export interface StaleFigure { name: string }
export interface PageOverflow { pages: number; limit: number }
export interface ReadingItem { key: string; title: string; status: ReadingStatus; statusChangedAt?: string }

export interface ChecklistInput {
  todos: readonly TodoItem[];
  brokenRefs: readonly BrokenReference[];
  staleFigures: readonly StaleFigure[];
  /** Undefined when the body fits its page limit or no limit is set. */
  pageOverflow: PageOverflow | undefined;
  manual: readonly ManualItem[];
  reading: readonly ReadingItem[];
  placeSection: SectionPlacer;
  citeSections: ReadonlyMap<string, readonly ChecklistSection[]>;
}

export type ChecklistItem =
  | { kind: "todo"; done: false; todo: TodoItem }
  | { kind: "ref"; done: false; ref: BrokenReference }
  | { kind: "figure"; done: false; figure: StaleFigure }
  | { kind: "pages"; done: false; overflow: PageOverflow }
  | { kind: "manual"; done: boolean; manual: ManualItem }
  | { kind: "reading"; done: boolean; paper: ReadingItem };

export interface ChecklistGroup {
  id: string;
  title: string;
  items: ChecklistItem[];
  /** Items not done, Reading included. */
  open: number;
}

export interface Checklist {
  /** Non-empty groups only. */
  groups: ChecklistGroup[];
  /** Open items across the project, Reading excluded (D13). */
  openCount: number;
}

export type ChecklistGrouping = "kind" | "section";

interface Items {
  todos: ChecklistItem[];
  refs: ChecklistItem[];
  figures: ChecklistItem[];
  pages: ChecklistItem[];
  manual: ChecklistItem[];
  reading: ChecklistItem[];
}

function toItems(input: ChecklistInput): Items {
  return {
    todos: input.todos.map((todo) => ({ kind: "todo", done: false, todo })),
    refs: input.brokenRefs.map((ref) => ({ kind: "ref", done: false, ref })),
    figures: input.staleFigures.map((figure) => ({ kind: "figure", done: false, figure })),
    pages: input.pageOverflow ? [{ kind: "pages", done: false, overflow: input.pageOverflow }] : [],
    manual: input.manual.map((manual) => ({ kind: "manual", done: manual.done, manual })),
    reading: input.reading.map((paper) => ({ kind: "reading", done: paper.status === "done", paper })),
  };
}

const group = (id: string, title: string, items: ChecklistItem[]): ChecklistGroup => ({ id, title, items, open: items.filter((item) => !item.done).length });

/** A manual item with a group follows that group's own items; one without stays in Manual, a section-only one included. */
function byKind(items: Items): ChecklistGroup[] {
  const placed = (id: string, own: ChecklistItem[]): ChecklistItem[] =>
    [...own, ...items.manual.filter((item) => item.kind === "manual" && item.manual.group === id)];
  return [
    group("todo", "TODOs", placed("todo", items.todos)),
    group("ref", "References", placed("ref", items.refs)),
    group("figure", "Figures", placed("figure", items.figures)),
    group("pages", "Pages", placed("pages", items.pages)),
    group("manual", "Manual", items.manual.filter((item) => item.kind === "manual" && item.manual.group === undefined)),
    group("reading", "Reading", placed("reading", items.reading)),
  ];
}

/** Section groups ordered by file of first appearance, then by heading line, a file's own node first. */
function sortSections(sections: ChecklistSection[]): ChecklistSection[] {
  const files = [...new Set(sections.map((section) => section.file))];
  return [...sections].sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file) || (a.line ?? -1) - (b.line ?? -1));
}

function bySection(input: ChecklistInput, items: Items): ChecklistGroup[] {
  const sections = new Map<string, { section: ChecklistSection; items: ChecklistItem[] }>();
  const add = (section: ChecklistSection, item: ChecklistItem): void => {
    const entry = sections.get(section.id) ?? { section, items: [] };
    entry.items.push(item);
    sections.set(section.id, entry);
  };
  for (const item of items.todos) { if (item.kind === "todo") { add(input.placeSection(item.todo.file, item.todo.line), item); } }
  for (const item of items.refs) { if (item.kind === "ref") { add(input.placeSection(item.ref.file, item.ref.line), item); } }
  const uncited: ChecklistItem[] = [];
  for (const item of items.reading) {
    const citing = item.kind === "reading" ? input.citeSections.get(item.paper.key) ?? [] : [];
    if (citing.length === 0) { uncited.push(item); }
    for (const section of citing) { add(section, item); }
  }
  const ordered = sortSections([...sections.values()].map((entry) => entry.section));
  // A manual item follows its section's own rows; an item whose section is absent from the file goes to Whole project.
  const sectionIds = new Set<string>(ordered.map((section) => section.id));
  const manualIn = (id: string): ChecklistItem[] => items.manual.filter((item) => item.kind === "manual" && item.manual.section === id);
  const wholeManual = items.manual.filter((item) => item.kind === "manual"
    && (item.manual.section === undefined || item.manual.section === "#whole-project" || !sectionIds.has(item.manual.section)));
  return [
    ...ordered.map((section) => group(section.id, section.title, [...sections.get(section.id)!.items, ...manualIn(section.id)])),
    // Ids start with "#" so they never collide with a section id, which starts with a file path.
    group("#whole-project", "Whole project", [...items.figures, ...items.pages, ...wholeManual]),
    group("#reading", "Reading", uncited),
  ];
}

export function buildChecklist(input: ChecklistInput, grouping: ChecklistGrouping): Checklist {
  const items = toItems(input);
  const groups = (grouping === "kind" ? byKind(items) : bySection(input, items)).filter((g) => g.items.length > 0);
  const openCount = Object.values(items).flat().filter((item: ChecklistItem) => !item.done && item.kind !== "reading").length;
  return { groups, openCount };
}
