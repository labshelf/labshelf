/** Groups a project's checklist items by kind or by section, with open counts. */
import type { ReadingStatus } from "../../library/readingStatus/index.js";
import type { ManualItem } from "./checklistFile.js";
import type { ChecklistSection, SectionPlacer } from "./sectionPlacement.js";
import type { TodoItem } from "./scanTodos.js";

export interface BrokenRef { file: string; line: number; ref: string }
export interface StaleFigure { name: string }
export interface PageOverflow { pages: number; limit: number }
export interface ReadingItem { key: string; title: string; status: ReadingStatus; statusChangedAt?: string }

export interface ChecklistInput {
  todos: readonly TodoItem[];
  brokenRefs: readonly BrokenRef[];
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
  | { kind: "ref"; done: false; ref: BrokenRef }
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
  // A manual item follows its section's own rows; a section that no longer exists sends it to Whole project.
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
