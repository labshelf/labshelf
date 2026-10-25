import { formatDay } from "../../../src/library/paper/date";

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
