// Builds the overview of one Space (desk, timeline, linked projects) and exports its dates as an iCalendar file.
import { countDaysBetween, nextDay } from "../time/index.js";
import { listDeskItems, SPACE_DESK_LIMIT, type Space, type SpaceDate, type SpaceDeskItem } from "./space.js";
import type { SpaceThreadEntry } from "./spaceDiscussionsStore.js";
import type { SpaceNoteEntry, SpaceQmdItem } from "./spaceNotesStore.js";
import { resolvePaper, type DeskCard, type LibraryPapers, type Progress, type SpaceOverview, type SpaceProjectEntry, type TimelineEntry } from "./spaceViews.js";

/** The notes, topics and item files the desk cards read; a file absent from `files` shows as missing. */
export interface DeskSources {
  readonly notes: readonly SpaceNoteEntry[];
  readonly threads: readonly SpaceThreadEntry[];
  /** Items by file path, for the notes and topics on the desk. */
  readonly files: ReadonlyMap<string, readonly SpaceQmdItem[]>;
}

/** How many items of a note its desk card previews. */
const NOTE_PREVIEW_ITEMS = 3;
const NO_SOURCES: DeskSources = { notes: [], threads: [], files: new Map() };

export function buildOverview(
  space: Space, library: LibraryPapers, projects: readonly SpaceProjectEntry[], today: string, sources: DeskSources = NO_SOURCES,
): SpaceOverview {
  return {
    timeline: buildTimeline(space, library, projects, today),
    desk: listDeskItems(space).slice(0, SPACE_DESK_LIMIT).map((item) => buildDeskCard(space, item, library, projects, sources)),
    projects: space.projects.map((id) => findProject(projects, id)),
  };
}

const findProject = (projects: readonly SpaceProjectEntry[], id: string): SpaceProjectEntry =>
  projects.find((p) => p.projectId === id) ?? { projectId: id, title: id, available: false };

/** The body without its first `# ` heading line. */
const withoutHeading = (body: string): string => body.replace(/^[ \t]*#[ \t]+.*(?:\r?\n)?/, "").trim();

function buildDeskCard(space: Space, item: SpaceDeskItem, library: LibraryPapers, projects: readonly SpaceProjectEntry[], sources: DeskSources): DeskCard {
  const { kind, ref } = item;
  if (kind === "paper") { return { kind, ref, paper: resolvePaper(ref, library, space.papers.find((p) => p.id === ref)) }; }
  if (kind === "project") { return { kind, ref, project: findProject(projects, ref) }; }
  const items = sources.files.get(ref);
  if (kind === "note") {
    const note = sources.notes.find((entry) => entry.path === ref);
    if (!note || !items) { return { kind, ref, missing: true }; }
    return { kind, ref, missing: false, title: note.title, body: items.slice(0, NOTE_PREVIEW_ITEMS).map((entry) => entry.body).join("\n\n"), updated: note.updated };
  }
  const thread = sources.threads.find((entry) => entry.path === ref);
  if (!thread || !items) { return { kind, ref, missing: true }; }
  const [topic, ...messages] = items;
  const last = messages.at(-1);
  return {
    kind, ref, missing: false, title: thread.title, status: thread.status, topic: withoutHeading(topic?.body ?? ""), replies: messages.length,
    ...(last ? { last: { body: last.body, ...(last.author ? { author: last.author } : {}), ...(last.created ? { created: last.created } : {}) } } : {}),
  };
}

/** A deadline entry for each linked project that is available and has a deadline. */
function deriveProjectDeadlines(space: Space, projects: readonly SpaceProjectEntry[]): Array<{ id: string; title: string; date: string }> {
  return space.projects.flatMap((projectId) => {
    const info = projects.find((p) => p.projectId === projectId);
    return info?.available && info.deadline ? [{ id: `deadline-${projectId}`, title: info.title, date: info.deadline }] : [];
  });
}

function progressOf(d: SpaceDate, library: LibraryPapers, projects: readonly SpaceProjectEntry[]): Progress | undefined {
  if (d.kind === "read" && d.paperIds) {
    const done = d.paperIds.filter((id) => {
      const paper = resolvePaper(id, library);
      return !paper.missing && paper.status === "done";
    }).length;
    return { done, total: d.paperIds.length };
  }
  if (d.kind === "project" && d.projectId) return projects.find((p) => p.projectId === d.projectId && p.available)?.checklist;
  return undefined;
}

function entry(base: Pick<TimelineEntry, "id" | "kind" | "title" | "date">, today: string, extra: Partial<TimelineEntry>): TimelineEntry {
  const daysAway = countDaysBetween(today, base.date);
  const when = daysAway < 0 ? "past" : daysAway === 0 ? "today" : "future";
  return { ...base, when, daysAway, overdue: when === "past" && base.kind === "task" && extra.done === false, ...extra };
}

function buildTimeline(space: Space, library: LibraryPapers, projects: readonly SpaceProjectEntry[], today: string): TimelineEntry[] {
  const own = space.dates.map((d) => {
    const progress = progressOf(d, library, projects);
    return entry(d, today, { ...(d.kind === "task" ? { done: d.done } : {}), ...(progress ? { progress } : {}) });
  });
  const linked = deriveProjectDeadlines(space, projects).map((d) => entry({ ...d, kind: "deadline" }, today, { fromProject: true }));
  return [...own, ...linked].sort((a, b) => a.date.localeCompare(b.date));
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const utf8Length = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Folds a line into physical lines of at most 75 octets, each continuation starting with one space; never splits a character. */
function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = utf8Length(ch.codePointAt(0)!);
    // A continuation line spends one octet on its leading space.
    if (octets + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (day: string): string => day.replace(/-/g, "");

function stampText(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** `stampMs` is the creation time written to every event's DTSTAMP. */
export function buildIcs(space: Space, projects: readonly SpaceProjectEntry[], stampMs: number): string {
  const stamp = stampText(stampMs);
  const entries = [...space.dates, ...deriveProjectDeadlines(space, projects)].filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LabShelf//Spaces//EN", "CALSCALE:GREGORIAN"];
  for (const e of entries) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${space.id}-${e.id}@labshelf`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(e.date)}`,
      `DTEND;VALUE=DATE:${compactDate(nextDay(e.date))}`,
      `SUMMARY:${escapeIcsText(e.title)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
