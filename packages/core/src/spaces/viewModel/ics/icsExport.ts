// Exports a Space's dates and linked project deadlines as an iCalendar file of all-day events.
import type { Space } from "../../model/index.js";
import { escapeIcsText, foldIcsLine } from "./icsText.js";
import { projectDeadlines } from "../spaceOverview/index.js";
import type { SpaceProjectInfo } from "../spaceViewModel.js";

const compactDate = (day: string): string => day.replace(/-/g, "");

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function stampText(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** `stampMs` is the creation time written to every event's DTSTAMP. */
export function buildIcs(space: Space, projects: readonly SpaceProjectInfo[], stampMs: number): string {
  const stamp = stampText(stampMs);
  const entries = [...space.dates, ...projectDeadlines(space, projects)].filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
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
