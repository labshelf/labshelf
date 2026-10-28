/** Verifies the display formatters: each keeps the locale and time zone its screen uses. */
import {
  formatClockTime, formatDateTime, formatDayLabel, formatLocaleDateTime, formatShortDate, formatShortDateTime, formatUtcDate,
} from "../../src/time/index";

describe("formatDateTime", () => {
  it("is empty for a missing or broken timestamp", () => {
    expect(formatDateTime(undefined)).toBe("");
    expect(formatDateTime("not a date")).toBe("");
  });

  it("shows the date and the time", () => {
    const text = formatDateTime("2024-03-04T14:05:00");
    expect(text).toContain("Mar 4, 2024");
    expect(text).toMatch(/2:05\s?PM/);
  });
});

describe("formatUtcDate", () => {
  it("reads the UTC day with fixed month names", () => {
    expect(formatUtcDate("2024-03-04T23:30:00Z")).toBe("4 Mar 2024");
    expect(formatUtcDate("2024-12-31T00:00:00Z")).toBe("31 Dec 2024");
  });

  it("is empty for a broken timestamp", () => {
    expect(formatUtcDate("not a date")).toBe("");
  });
});

describe("formatShortDate", () => {
  it("gives the month name and the day", () => {
    expect(formatShortDate(new Date(2024, 2, 4, 12).toISOString())).toBe("Mar 4");
  });
});

describe("formatClockTime and formatShortDateTime", () => {
  const iso = new Date(2024, 2, 4, 14, 5).toISOString();

  it("show the minutes of the time", () => {
    expect(formatClockTime(iso)).toMatch(/05/);
    expect(formatShortDateTime(iso)).toMatch(/05/);
  });

  it("add the day to the date-time form only", () => {
    expect(formatShortDateTime(iso)).toMatch(/4/);
    expect(formatShortDateTime(iso).length).toBeGreaterThan(formatClockTime(iso).length);
  });
});

describe("formatLocaleDateTime", () => {
  it("matches the runtime default date-time text", () => {
    const iso = new Date(2024, 2, 4, 14, 5).toISOString();
    expect(formatLocaleDateTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});

describe("formatDayLabel", () => {
  const now = new Date(2026, 9, 22, 15).getTime();

  it("says Today and Yesterday for the injected clock", () => {
    expect(formatDayLabel(new Date(2026, 9, 22, 1).toISOString(), now)).toBe("Today");
    expect(formatDayLabel(new Date(2026, 9, 21, 23).toISOString(), now)).toBe("Yesterday");
  });

  it("names the weekday for an older day", () => {
    expect(formatDayLabel(new Date(2026, 9, 15, 9).toISOString(), now)).toBe(
      new Date(2026, 9, 15, 9).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }),
    );
  });

  it("reads the system clock when none is given", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(now);
      expect(formatDayLabel(new Date(2026, 9, 22, 8).toISOString())).toBe("Today");
    } finally {
      jest.useRealTimers();
    }
  });
});
