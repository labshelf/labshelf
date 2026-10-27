// Builds the overview of one Space (timeline, papers in focus, linked projects) and exports its dates as an iCalendar file.
import { countDaysBetween, nextDay } from "../time/index.js";
import type { Space, SpaceDate } from "./model/index.js";
import { resolvePaper, type LibraryPapers, type Progress, type SpaceOverview, type SpaceProjectEntry, type TimelineEntry } from "./spaceViews.js";

export function buildOverview(space: Space, library: LibraryPapers, projects: readonly SpaceProjectEntry[], today: string): SpaceOverview {
  return {
    timeline: buildTimeline(space, library, projects, today),
    focus: space.papers.filter((p) => p.focus).map((p) => resolvePaper(p.id, library)),
    projects: space.projects.map((id) => projects.find((p) => p.projectId === id) ?? { projectId: id, title: id, available: false }),
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
