/** Verifies the .ics export: events, escaping, CRLF, folding at 75 octets and stable UIDs. */
import { buildIcs } from "../../../src/spaces/viewModel/index";
import { date, project, space } from "./viewFixture";

const STAMP = Date.UTC(2026, 9, 21, 8, 30, 0);
const lines = (ics: string) => ics.split("\r\n");

describe("buildIcs", () => {
  const s = space({ projects: ["p1"], dates: [date("d1", { title: "Report due", date: "2026-11-14" })] });
  const ics = buildIcs(s, [project("p1", { deadline: "2026-12-01" })], STAMP);

  it("writes an all-day event per date and project deadline with stable UIDs, CRLF throughout", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    const l = lines(ics);
    expect(l.slice(0, 2)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0"]);
    expect(l.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(2);
    expect(l).toContain("UID:s-d1@labshelf");
    expect(l).toContain("UID:s-deadline-p1@labshelf");
    expect(l).toContain("DTSTART;VALUE=DATE:20261114");
    expect(l).toContain("DTEND;VALUE=DATE:20261115");
    expect(l).toContain("DTSTAMP:20261021T083000Z");
    expect(l).toContain("SUMMARY:Project p1");
  });

  it("escapes backslash, semicolon, comma and newlines in text", () => {
    const e = buildIcs(space({ dates: [date("d", { title: "a,b;c\\d\ne\r\nf" })] }), [], STAMP);
    expect(e).toContain("SUMMARY:a\\,b\;c\\\\d\\ne\\nf\r\n");
  });

  it("folds lines longer than 75 octets without splitting a multi-byte character", () => {
    const e = buildIcs(space({ dates: [date("d", { title: "é".repeat(80) })] }), [], STAMP);
    const folded = lines(e);
    for (const line of folded) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const i = folded.findIndex((x) => x.startsWith("SUMMARY:"));
    expect(folded[i + 1]!.startsWith(" ")).toBe(true);
    const joined = e.replace(/\r\n /g, "");
    expect(joined).toContain(`SUMMARY:${"é".repeat(80)}\r\n`);
  });
});
