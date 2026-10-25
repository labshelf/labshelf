import { formatRelativeTime } from "../../../src/library/paper/index";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = new Date(2026, 9, 8, 12, 0, 0).getTime();
const ago = (ms: number): string => new Date(now - ms).toISOString();

describe("relativeTime", () => {
  it("is empty for a missing or invalid date", () => {
    expect(formatRelativeTime(undefined, now)).toBe("");
    expect(formatRelativeTime("", now)).toBe("");
    expect(formatRelativeTime("yesterday-ish", now)).toBe("");
  });

  it("says just now under a minute and for the future", () => {
    expect(formatRelativeTime(ago(0), now)).toBe("just now");
    expect(formatRelativeTime(ago(59 * SECOND), now)).toBe("just now");
    expect(formatRelativeTime(ago(-5 * MINUTE), now)).toBe("just now");
  });

  it("floors to minutes and hours", () => {
    expect(formatRelativeTime(ago(MINUTE), now)).toBe("1m ago");
    expect(formatRelativeTime(ago(119 * SECOND), now)).toBe("1m ago");
    expect(formatRelativeTime(ago(59 * MINUTE), now)).toBe("59m ago");
    expect(formatRelativeTime(ago(HOUR), now)).toBe("1h ago");
    expect(formatRelativeTime(ago(23 * HOUR + 59 * MINUTE), now)).toBe("23h ago");
  });

  it("says yesterday for one day, then days and weeks", () => {
    expect(formatRelativeTime(ago(DAY), now)).toBe("yesterday");
    expect(formatRelativeTime(ago(2 * DAY - SECOND), now)).toBe("yesterday");
    expect(formatRelativeTime(ago(2 * DAY), now)).toBe("2d ago");
    expect(formatRelativeTime(ago(6 * DAY), now)).toBe("6d ago");
    expect(formatRelativeTime(ago(7 * DAY), now)).toBe("1w ago");
    expect(formatRelativeTime(ago(29 * DAY), now)).toBe("4w ago");
  });

  it("shows the month and day under a year, the month and year after", () => {
    const thirtyDays = new Date(now - 30 * DAY);
    expect(formatRelativeTime(thirtyDays.toISOString(), now)).toBe(`Sep ${thirtyDays.getDate()}`);
    expect(formatRelativeTime(new Date(2026, 0, 15, 8).toISOString(), now)).toBe("Jan 15");
    expect(formatRelativeTime(new Date(2025, 0, 15, 8).toISOString(), now)).toBe("Jan 2025");
  });

  it("reads the real clock when no now is given", () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe("just now");
    expect(formatRelativeTime(new Date(Date.now() - 2 * HOUR).toISOString())).toBe("2h ago");
  });
});
