import { countDaysBetween, formatDay, formatLocalDay, isCalendarDay, nextDay } from "../../src/time/index";

describe("formatDay", () => {
  it("formats a YYYY-MM-DD day as a medium English date", () => {
    expect(formatDay("2026-10-15")).toBe("Oct 15, 2026");
    expect(formatDay("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("keeps the day in a time zone west of UTC", () => {
    const previous = process.env["TZ"];
    process.env["TZ"] = "America/Los_Angeles";
    try {
      expect(formatDay("2026-10-15")).toBe("Oct 15, 2026");
    } finally {
      if (previous === undefined) delete process.env["TZ"]; else process.env["TZ"] = previous;
    }
  });

  it("returns an empty string for anything that is not a day", () => {
    for (const bad of ["", "not a date", "2026-10", "2026-13-45", "2026-10-15T10:00:00Z"]) expect(formatDay(bad)).toBe("");
  });
});

describe("isCalendarDay", () => {
  it("accepts a real day, including a leap day", () => {
    expect(isCalendarDay("2026-10-15")).toBe(true);
    expect(isCalendarDay("2024-02-29")).toBe(true);
  });

  it("rejects a day the month does not have", () => {
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2025-02-29")).toBe(false);
    expect(isCalendarDay("2026-13-01")).toBe(false);
  });

  it("rejects other shapes and anything that is not text", () => {
    for (const bad of ["", "2026-1-5", "2026-10-15T00:00:00Z", " 2026-10-15"]) expect(isCalendarDay(bad)).toBe(false);
    for (const bad of [undefined, null, 20261015, new Date(0), {}]) expect(isCalendarDay(bad)).toBe(false);
  });
});

describe("nextDay", () => {
  it("steps over month and year ends and leap days", () => {
    expect(nextDay("2026-10-15")).toBe("2026-10-16");
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
    expect(nextDay("2024-02-29")).toBe("2024-03-01");
  });
});

describe("countDaysBetween", () => {
  it("counts calendar days in either direction", () => {
    expect(countDaysBetween("2026-10-15", "2026-10-15")).toBe(0);
    expect(countDaysBetween("2026-10-15", "2026-10-22")).toBe(7);
    expect(countDaysBetween("2026-10-22", "2026-10-15")).toBe(-7);
    expect(countDaysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("formatLocalDay", () => {
  it("splits days at local midnight", () => {
    expect(formatLocalDay(new Date(2026, 9, 21, 23, 59, 59).getTime())).toBe("2026-10-21");
    expect(formatLocalDay(new Date(2026, 9, 22, 0, 0, 0).getTime())).toBe("2026-10-22");
  });
});
