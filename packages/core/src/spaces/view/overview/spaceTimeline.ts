// Builds the dated timeline of a Space: its own dates plus the deadlines of linked projects.
import type { Space, SpaceDate } from "../../model/index.js";
import { daysBetween } from "../localDay.js";
import { resolvePaper, type LibraryPapers } from "../resolvePaper.js";
import type { Progress, SpaceProjectInfo, TimelineEntry } from "../viewTypes.js";

/** A deadline entry for each linked project that is available and has a deadline. */
export function projectDeadlines(space: Space, projects: readonly SpaceProjectInfo[]): Array<{ id: string; title: string; date: string }> {
  return space.projects.flatMap((projectId) => {
    const info = projects.find((p) => p.projectId === projectId);
    return info?.available && info.deadline ? [{ id: `deadline-${projectId}`, title: info.title, date: info.deadline }] : [];
  });
}

function progressOf(d: SpaceDate, library: LibraryPapers, projects: readonly SpaceProjectInfo[]): Progress | undefined {
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
  const daysAway = daysBetween(today, base.date);
  const when = daysAway < 0 ? "past" : daysAway === 0 ? "today" : "future";
  return { ...base, when, daysAway, overdue: when === "past" && base.kind === "task" && extra.done === false, ...extra };
}

export function buildTimeline(space: Space, library: LibraryPapers, projects: readonly SpaceProjectInfo[], today: string): TimelineEntry[] {
  const own = space.dates.map((d) => {
    const progress = progressOf(d, library, projects);
    return entry(d, today, { ...(d.kind === "task" ? { done: d.done } : {}), ...(progress ? { progress } : {}) });
  });
  const linked = projectDeadlines(space, projects).map((d) => entry({ ...d, kind: "deadline" }, today, { fromProject: true }));
  return [...own, ...linked].sort((a, b) => a.date.localeCompare(b.date));
}
