// Derives and serves the Home page from the personal desk, the Spaces, the Library and the projects: desk cards, what needs you today and what comes next, and the desk actions.
import { countDaysBetween } from "../time/index.js";
import type { HomeAction, HostToSpaces, SpacesToHost } from "./spacesProtocol.js";
import type { SpacesHostPort } from "./spacesHostPort.js";
import type { SpaceStore } from "./spaceStore.js";
import type { HomeStore } from "./homeStore.js";
import { homeEntryId, HOME_DESK_LIMIT, type HomeDeskEntry, type HomeFile, type HomeLink, type HomeTask } from "./homeFile.js";
import { placeOfSpace, type Space, type SpaceDateKind, type SpaceReadResult } from "./space.js";
import type { SpaceThreadEntry } from "./spaceDiscussionsStore.js";
import type { SpaceNoteEntry } from "./spaceNotesStore.js";
import { buildOverview } from "./spaceOverview.js";
import { deriveCatalogRows, resolvePaper, type CatalogRow, type LibraryPapers, type ResolvedPaper, type SpaceProjectEntry } from "./spaceViews.js";

/** Where a row or card opens; absent when it opens nothing. */
export type HomeTarget = { readonly type: "paper"; readonly paperId: string } | { readonly type: "project"; readonly projectId: string } | { readonly type: "space"; readonly id: string };

interface HomeLinkView { readonly kind: HomeLink["kind"]; readonly ref: string; readonly title: string; readonly missing: boolean }

/** `note` is the user's own reminder on the entry. */
export type HomeDeskCard = { readonly note?: string } & (
  | { readonly id: string; readonly kind: "paper"; readonly ref: string; readonly paper: ResolvedPaper }
  /** `excerpt` holds the first lines of the main file, when the host could read them. */
  | { readonly id: string; readonly kind: "project"; readonly ref: string; readonly project: SpaceProjectEntry; readonly excerpt?: readonly string[] }
  /** `notes` counts the Space's notes, when its list was read. */
  | { readonly id: string; readonly kind: "space"; readonly ref: string; readonly space?: CatalogRow; readonly notes?: number }
  | { readonly id: string; readonly kind: "note" | "thread"; readonly ref: string; readonly spaceId: string; readonly spaceName?: string; readonly title?: string }
  | { readonly id: string; readonly kind: "task"; readonly title: string; readonly description?: string; readonly date?: string; readonly daysAway?: number; readonly link?: HomeLinkView });

/** One line of Recent in your Spaces: a note or topic changed, or a paper added to a Space. */
export interface HomeRecentRow {
  readonly key: string;
  readonly kind: "note" | "thread" | "paper";
  /** "Note updated", "New reply", "New topic", "Paper added". */
  readonly label: string;
  readonly title: string;
  readonly spaceId: string;
  readonly spaceName: string;
  /** ISO time of the change. */
  readonly at: string;
  readonly minutesAgo: number;
  /** Set on a paper row whose paper is in the Library. */
  readonly paperId?: string;
}

/** One dated row of Needs you or Up next; a desk task has kind "task" and no Space. */
export interface HomeAgendaRow {
  readonly key: string;
  readonly kind: SpaceDateKind;
  readonly title: string;
  readonly date: string;
  /** HH:MM, set on a meeting with a start time. */
  readonly time?: string;
  /** Calendar days from today; negative in the past. */
  readonly daysAway: number;
  readonly spaceId?: string;
  readonly spaceName?: string;
  /** Set on a desk task, the id that completes it. */
  readonly taskId?: string;
  readonly target?: HomeTarget;
}

export interface HomeView {
  readonly desk: readonly HomeDeskCard[];
  readonly deskLimit: number;
  /** YYYY-MM-DD, the day the view was built for. */
  readonly today: string;
  readonly needsYou: readonly HomeAgendaRow[];
  readonly upNext: readonly HomeAgendaRow[];
  /** Every open dated row from 30 days back to 60 days ahead, for the month calendar. */
  readonly calendar: readonly HomeAgendaRow[];
  /** The latest changes in the Spaces, newest first. */
  readonly recent: readonly HomeRecentRow[];
  /** The Spaces in the Spaces place, for the pickers. */
  readonly spaces: readonly { readonly id: string; readonly name: string; readonly icon?: string }[];
  readonly readOnlyReason?: string;
}

/** The notes and topics of the Spaces, by Space id. */
type HomeSpaceLists = ReadonlyMap<string, { readonly notes: readonly SpaceNoteEntry[]; readonly threads: readonly SpaceThreadEntry[] }>;

export interface HomeSources {
  readonly home: HomeFile;
  readonly spaces: readonly SpaceReadResult[];
  readonly library: LibraryPapers;
  readonly projects: readonly SpaceProjectEntry[];
  /** YYYY-MM-DD */
  readonly today: string;
  readonly lists?: HomeSpaceLists;
  /** The excerpt of each pinned project's main file, by project id. */
  readonly excerpts?: ReadonlyMap<string, readonly string[]>;
  /** Epoch ms of now, for Recent; absent shows no recent rows. */
  readonly now?: number;
}

/** How many rows Up next shows. */
const HOME_UP_NEXT_LIMIT = 8;
/** How many rows Recent shows, and how far back it looks. */
const HOME_RECENT_LIMIT = 5;
const HOME_RECENT_DAYS = 14;
/** The window of the month calendar, in days from today. */
const CALENDAR_PAST_DAYS = 30;
const CALENDAR_FUTURE_DAYS = 60;
/** How many lines of a project's main file its card shows. */
const PROJECT_EXCERPT_LINES = 5;

/** The first non-empty lines of a project's main file, without trailing spaces, for its Home card. */
export function projectExcerpt(text: string, limit = PROJECT_EXCERPT_LINES): string[] {
  return text.split(/\r\n|\r|\n/).map((line) => line.trimEnd().slice(0, 200)).filter((line) => line.trim() !== "").slice(0, limit);
}

/** The changes of the last 14 days in the Spaces, newest first: notes and topics by their file time, papers by when they were added. */
export function deriveHomeRecent(spaces: readonly Space[], lists: HomeSpaceLists, library: LibraryPapers, now: number, limit = HOME_RECENT_LIMIT): HomeRecentRow[] {
  const since = now - HOME_RECENT_DAYS * 86_400_000;
  const rows: HomeRecentRow[] = [];
  const add = (row: Omit<HomeRecentRow, "minutesAgo" | "at">, at: string | undefined): void => {
    const time = at === undefined ? Number.NaN : Date.parse(at);
    if (!Number.isFinite(time) || time < since || time > now + 60_000) { return; }
    rows.push({ ...row, at: new Date(time).toISOString(), minutesAgo: Math.max(0, Math.floor((now - time) / 60_000)) });
  };
  for (const space of spaces) {
    const base = { spaceId: space.id, spaceName: space.name };
    const list = lists.get(space.id);
    for (const note of list?.notes ?? []) { add({ ...base, key: `${space.id}:note:${note.path}`, kind: "note", label: "Note updated", title: note.title }, note.updated); }
    for (const thread of list?.threads ?? []) {
      add({ ...base, key: `${space.id}:thread:${thread.path}`, kind: "thread", label: thread.messages > 1 ? "New reply" : "New topic", title: thread.title }, thread.updated);
    }
    for (const paper of space.papers) {
      const resolved = resolvePaper(paper.id, library);
      add({ ...base, key: `${space.id}:paper:${paper.id}`, kind: "paper", label: "Paper added",
        title: resolved.missing ? resolved.remote?.title ?? paper.id : resolved.title, ...(resolved.missing ? {} : { paperId: paper.id }) }, paper.addedAt);
    }
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title)).slice(0, limit);
}

const readySpaces = (results: readonly SpaceReadResult[]): Space[] =>
  results.flatMap((r) => (r.state === "ready" && placeOfSpace(r.space) === "spaces" ? [r.space] : []));

function linkView(link: HomeLink, s: HomeSources, rows: readonly CatalogRow[]): HomeLinkView {
  if (link.kind === "paper") {
    const paper = resolvePaper(link.ref, s.library);
    return { ...link, title: paper.missing ? link.ref : paper.title, missing: paper.missing };
  }
  if (link.kind === "project") {
    const project = s.projects.find((p) => p.projectId === link.ref);
    return { ...link, title: project?.title ?? link.ref, missing: !project?.available };
  }
  const row = rows.find((r) => r.id === link.ref && r.place !== "trash" && r.unreadable === undefined);
  return { ...link, title: row?.name ?? link.ref, missing: !row };
}

function targetOfLink(link: Pick<HomeLink, "kind" | "ref">): HomeTarget {
  if (link.kind === "paper") { return { type: "paper", paperId: link.ref }; }
  return link.kind === "project" ? { type: "project", projectId: link.ref } : { type: "space", id: link.ref };
}

function taskCard(task: HomeTask, s: HomeSources, rows: readonly CatalogRow[]): HomeDeskCard {
  return {
    id: task.id, kind: "task", title: task.title,
    ...(task.description ? { description: task.description } : {}),
    ...(task.date ? { date: task.date, daysAway: countDaysBetween(s.today, task.date) } : {}),
    ...(task.link ? { link: linkView(task.link, s, rows) } : {}),
  };
}

function deskCard(entry: HomeDeskEntry, s: HomeSources, rows: readonly CatalogRow[]): HomeDeskCard {
  const card = deskCardOf(entry, s, rows);
  return entry.note ? { ...card, note: entry.note } : card;
}

function deskCardOf(entry: HomeDeskEntry, s: HomeSources, rows: readonly CatalogRow[]): HomeDeskCard {
  const id = homeEntryId(entry);
  switch (entry.kind) {
    case "task": return taskCard(entry, s, rows);
    case "paper": return { id, kind: "paper", ref: entry.ref, paper: resolvePaper(entry.ref, s.library) };
    case "project": {
      const excerpt = s.excerpts?.get(entry.ref);
      return { id, kind: "project", ref: entry.ref,
        project: s.projects.find((p) => p.projectId === entry.ref) ?? { projectId: entry.ref, title: entry.ref, available: false }, ...(excerpt?.length ? { excerpt } : {}) };
    }
    case "space": {
      const row = rows.find((r) => r.id === entry.ref && r.place !== "trash" && r.unreadable === undefined);
      const notes = s.lists?.get(entry.ref)?.notes.length;
      return { id, kind: "space", ref: entry.ref, ...(row ? { space: row } : {}), ...(notes !== undefined ? { notes } : {}) };
    }
    default: {
      const row = rows.find((r) => r.id === entry.space && r.unreadable === undefined);
      const list = s.lists?.get(entry.space);
      const found = (entry.kind === "note" ? list?.notes : list?.threads)?.find((item) => item.path === entry.ref);
      return { id, kind: entry.kind, ref: entry.ref, spaceId: entry.space, ...(row ? { spaceName: row.name } : {}), ...(found ? { title: found.title } : {}) };
    }
  }
}

/** The dated rows of every Space in the Spaces place: undone tasks, reading and project goals and deadlines, one per linked project deadline. */
function spaceRows(s: HomeSources): Array<HomeAgendaRow & { done: boolean; overdue: boolean }> {
  const seenDeadlines = new Set<string>();
  return readySpaces(s.spaces).flatMap((space) => buildOverview(space, s.library, s.projects, s.today).timeline.flatMap((entry) => {
    if (entry.fromProject) {
      if (seenDeadlines.has(entry.id)) { return []; }
      seenDeadlines.add(entry.id);
    }
    const date = space.dates.find((d) => d.id === entry.id);
    const target: HomeTarget = date?.kind === "read" && date.paperIds?.[0] ? { type: "paper", paperId: date.paperIds[0] }
      : date?.kind === "project" && date.projectId ? { type: "project", projectId: date.projectId } : { type: "space", id: space.id };
    const time = date?.kind === "meeting" ? date.start : undefined;
    return [{ key: `${space.id}:${entry.id}`, kind: entry.kind, title: entry.title, date: entry.date, ...(time ? { time } : {}), daysAway: entry.daysAway,
      spaceId: space.id, spaceName: space.name, target, done: entry.done === true, overdue: entry.overdue }];
  }));
}

function taskRows(s: HomeSources): HomeAgendaRow[] {
  return s.home.desk.flatMap((entry) => entry.kind === "task" && entry.date ? [{
    key: `task:${entry.id}`, kind: "task" as const, title: entry.title, date: entry.date, daysAway: countDaysBetween(s.today, entry.date),
    taskId: entry.id, ...(entry.link ? { target: targetOfLink(entry.link) } : {}),
  }] : []);
}

const byDate = (a: HomeAgendaRow, b: HomeAgendaRow): number => a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
const strip = ({ done: _done, overdue: _overdue, ...row }: HomeAgendaRow & { done: boolean; overdue: boolean }): HomeAgendaRow => row;

export function buildHomeView(s: HomeSources): HomeView {
  const rows = deriveCatalogRows(s.spaces, s.library, s.today);
  const fromSpaces = spaceRows(s);
  const tasks = taskRows(s);
  const needsYou = [...fromSpaces.filter((r) => r.overdue || (r.daysAway === 0 && !r.done)).map(strip), ...tasks.filter((r) => r.daysAway <= 0)].sort(byDate);
  const upNext = [...fromSpaces.filter((r) => r.daysAway > 0 && !r.done).map(strip), ...tasks.filter((r) => r.daysAway > 0)].sort(byDate).slice(0, HOME_UP_NEXT_LIMIT);
  const inWindow = (r: HomeAgendaRow): boolean => r.daysAway >= -CALENDAR_PAST_DAYS && r.daysAway <= CALENDAR_FUTURE_DAYS;
  const calendar = [...fromSpaces.filter((r) => !r.done && inWindow(r)).map(strip), ...tasks.filter(inWindow)].sort(byDate);
  return {
    desk: s.home.desk.slice(0, HOME_DESK_LIMIT).map((entry) => deskCard(entry, s, rows)),
    deskLimit: HOME_DESK_LIMIT,
    today: s.today,
    needsYou, upNext, calendar,
    recent: s.now === undefined ? [] : deriveHomeRecent(readySpaces(s.spaces), s.lists ?? new Map(), s.library, s.now),
    spaces: readySpaces(s.spaces).map((space) => ({ id: space.id, name: space.name, ...(space.icon ? { icon: space.icon } : {}) })),
    ...(s.home.readOnlyReason !== undefined ? { readOnlyReason: s.home.readOnlyReason } : {}),
  };
}

export interface ServeHomeOptions {
  readonly store: SpaceStore;
  readonly port: SpacesHostPort;
  readonly today: () => string;
  /** The personal Home desk; absent where the host has no Home, and the page shows the error. */
  readonly home?: HomeStore;
}

export const HOME_ACTION_LABELS: Record<HomeAction["type"], string> = {
  "home.pin": "Pin to Home",
  "home.unpin": "Unpin from Home",
  "home.setNote": "Edit reminder",
  "home.addTask": "Add task",
  "home.completeTask": "Complete task",
};

export const LOAD_HOME = "Load Home";

export const isHomeAction = (message: SpacesToHost): message is HomeAction => Object.hasOwn(HOME_ACTION_LABELS, message.type);

function requireHome(options: ServeHomeOptions): HomeStore {
  if (!options.home) { throw new Error("Home is not available here."); }
  return options.home;
}

/** Lists the notes and topics of each Space in the Spaces place and of each Space the desk pins a note or topic of. */
async function readLists(store: SpaceStore, home: HomeFile): Promise<HomeSpaceLists> {
  const results = store.list();
  const pinned = home.desk.flatMap((entry) => (entry.kind === "note" || entry.kind === "thread" ? [entry.space] : []));
  const known = new Set(results.flatMap((r) => (r.state === "ready" ? [r.space.id] : [])));
  const ids = [...new Set([...readySpaces(results).map((space) => space.id), ...pinned])].filter((id) => known.has(id));
  const lists = await Promise.all(ids.map(async (id) =>
    [id, { notes: await store.notes.list(id), threads: await store.discussions.list(id) }] as const));
  return new Map(lists);
}

/** The excerpt of each pinned project's main file; a project the host cannot read has none. */
async function readExcerpts(port: SpacesHostPort, home: HomeFile): Promise<ReadonlyMap<string, readonly string[]>> {
  const read = port.readProjectExcerpt?.bind(port);
  if (!read) { return new Map(); }
  const ids = home.desk.flatMap((entry) => (entry.kind === "project" ? [entry.ref] : []));
  const pairs = await Promise.all(ids.map(async (id) => [id, await read(id).catch(() => undefined)] as const));
  return new Map(pairs.flatMap(([id, lines]) => (lines?.length ? [[id, lines] as const] : [])));
}

export async function homeMessage(options: ServeHomeOptions): Promise<HostToSpaces> {
  const { store, port, today } = options;
  const [home, projects] = await Promise.all([requireHome(options).read(), port.projects()]);
  const [lists, excerpts] = await Promise.all([readLists(store, home), readExcerpts(port, home)]);
  return { type: "home", home: buildHomeView({ home, spaces: store.list(), library: port.library(), projects, today: today(), lists, excerpts, now: Date.now() }) };
}

export async function runHomeAction(options: ServeHomeOptions, message: HomeAction): Promise<void> {
  const home = requireHome(options);
  switch (message.type) {
    case "home.pin": return home.pin(message.item, message.note);
    case "home.setNote": return home.setNote(message.id, message.note);
    case "home.unpin": return home.unpin(message.id);
    case "home.completeTask": return home.completeTask(message.id);
    case "home.addTask": await home.addTask(message.task);
  }
}
