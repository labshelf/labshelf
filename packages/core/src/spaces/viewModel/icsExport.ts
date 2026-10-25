// Exports a Space's dates and linked project deadlines as an iCalendar file of all-day events.
import type { Space } from "../model/index.js";
import { projectDeadlines } from "./spaceOverview/index.js";
import type { SpaceProjectInfo } from "./spaceViewModel.js";

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
