// Validates the date and glossary term drafts the Spaces page sends, before the store checks them again.
import { isBoolean, isNonBlankString, isNonEmptyString, isNonEmptyStringList, isOptional, isRecord, isString } from "../guards/index.js";
import { isCalendarDay } from "../time/index.js";
import { isClockTime, isPage, parseSourceRef } from "./parseSpaceFile.js";
import type { SpaceDateInput, TermInput } from "./spaceMutations.js";

/** The source message and assignee of a task, or null when one is of the wrong type. */
function parseTaskExtras({ source, assignee }: Record<string, unknown>): Record<string, unknown> | null {
  const ref = source === undefined ? undefined : parseSourceRef(source);
  if ((source !== undefined && !ref) || !isOptional(assignee, isString)) { return null; }
  return { ...(ref ? { source: ref } : {}), ...(isNonBlankString(assignee) ? { assignee: assignee.trim() } : {}) };
}

/** The times, participants, agenda and source message of a meeting, or null when one is of the wrong type or it ends before it starts. */
function parseMeetingExtras(raw: Record<string, unknown>): Record<string, unknown> | null {
  const { start, end, participants, agenda } = raw;
  const task = parseTaskExtras({ source: raw["source"] });
  if (!task || !isOptional(start, isClockTime) || !isOptional(end, isClockTime) || !isOptional(participants, isNonEmptyStringList) || !isOptional(agenda, isString)) { return null; }
  if (isString(start) && isString(end) && end <= start) { return null; }
  return { ...task, ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), ...(participants === undefined ? {} : { participants }),
    ...(isNonBlankString(agenda) ? { agenda } : {}) };
}

export function parseDateDraft(raw: unknown): SpaceDateInput | undefined {
  if (!isRecord(raw) || !isNonBlankString(raw["title"]) || !isCalendarDay(raw["date"])) { return undefined; }
  const { kind, title, date, done, paperIds, projectId } = raw;
  switch (kind) {
    case "task": {
      const extras = parseTaskExtras(raw);
      return isBoolean(done) && extras ? { kind, title, date, done, ...extras } : undefined;
    }
    case "meeting": {
      const extras = parseMeetingExtras(raw);
      return extras ? { kind, title, date, ...extras } : undefined;
    }
    case "deadline": return { kind, title, date };
    case "read":
      if (paperIds === undefined) { return { kind, title, date }; }
      return isNonEmptyStringList(paperIds) ? { kind, title, date, paperIds } : undefined;
    case "project":
      if (projectId === undefined) { return { kind, title, date }; }
      return isNonEmptyString(projectId) ? { kind, title, date, projectId } : undefined;
    default: return undefined;
  }
}

function parseSource(raw: unknown): TermInput["source"] | null {
  if (!isRecord(raw) || !isNonEmptyString(raw["paperId"])) { return null; }
  const { paperId, page } = raw;
  if (page === undefined) { return { paperId }; }
  return isPage(page) ? { paperId, page } : null;
}

export function parseTermDraft(raw: unknown): TermInput | undefined {
  if (!isRecord(raw) || !isNonBlankString(raw["term"]) || !isString(raw["definition"])) { return undefined; }
  const { term, definition, symbol, source } = raw;
  if (symbol !== undefined && !isString(symbol)) { return undefined; }
  const parsedSource = source === undefined ? undefined : parseSource(source);
  if (parsedSource === null) { return undefined; }
  return {
    term, definition,
    ...(symbol === undefined ? {} : { symbol }),
    ...(parsedSource === undefined ? {} : { source: parsedSource }),
  };
}
