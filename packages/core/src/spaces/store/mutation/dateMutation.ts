// Changes the dated entries of a Space: tasks, reading plans, project milestones and deadlines.
import { createEntryId, parseEntryIds } from "../../model/index.js";
import { isCalendarDay } from "../../../time/index.js";
import { isNonEmptyStringList, isNonEmptyString, isOptional } from "../../../guards/index.js";
import type { Space, SpaceDate } from "../../model/index.js";
import type { Edited } from "./folderMutation.js";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
/** A date as the caller describes it; the store adds the id and keeps unknown keys. */
export type SpaceDateInput = DistributiveOmit<SpaceDate, "id" | "extra">;

function checked(draft: SpaceDateInput): void {
  if (draft.title.trim() === "") { throw new Error("A date needs a title."); }
  if (!isCalendarDay(draft.date)) { throw new Error(`"${draft.date}" is not a YYYY-MM-DD date.`); }
  if (draft.kind === "read" && !isOptional(draft.paperIds, isNonEmptyStringList)) { throw new Error("paperIds is not a list of paper ids."); }
  if (draft.kind === "project" && !isOptional(draft.projectId, isNonEmptyString)) { throw new Error("projectId is not a project id."); }
}

function requireDate(space: Space, dateId: string): SpaceDate {
  const found = space.dates.find((date) => date.id === dateId);
  if (!found) { throw new Error(`Date ${dateId} is not in this Space.`); }
  return found;
}

export function withDate(space: Space, draft: SpaceDateInput): Edited<string> {
  checked(draft);
  const id = createEntryId(new Set([...space.dates.map((date) => date.id), ...parseEntryIds(space.invalid.dates)]));
  return { space: { ...space, dates: [...space.dates, { ...draft, id, extra: {} } as SpaceDate] }, value: id };
}

/** Replaces the entry's content, kind included; its id and unknown keys stay. */
export function withUpdatedDate(space: Space, dateId: string, draft: SpaceDateInput): Space {
  checked(draft);
  const old = requireDate(space, dateId);
  const next = { ...draft, id: dateId, extra: old.extra } as SpaceDate;
  return { ...space, dates: space.dates.map((date) => (date.id === dateId ? next : date)) };
}

export function withDateRemoved(space: Space, dateId: string): Space {
  return { ...space, dates: space.dates.filter((date) => date.id !== dateId) };
}

export function withDone(space: Space, dateId: string, done: boolean): Space {
  const date = requireDate(space, dateId);
  if (date.kind !== "task") { throw new Error(`Date ${dateId} is a ${date.kind}, not a task.`); }
  return { ...space, dates: space.dates.map((entry) => (entry.id === dateId ? { ...date, done } : entry)) };
}
