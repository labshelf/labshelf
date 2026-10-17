// Tests how many days are left until a project's deadline, counted in local calendar days.
import { deadlineText } from "../../../src/writing/allProjects/index";

const now = new Date(2026, 9, 17, 23, 30).getTime();

describe("deadlineText", () => {
  it("counts the days to a distant deadline as normal", () => {
    expect(deadlineText({ venue: "ICLR", deadline: "2026-11-27" }, now)).toEqual({ text: "41 d", tone: "normal" });
  });

  it("marks a deadline within 14 days as near", () => {
    expect(deadlineText({ deadline: "2026-10-31" }, now)).toEqual({ text: "14 d", tone: "near" });
  });

  it("reads today as 0 d, near, even late in the day", () => {
    expect(deadlineText({ deadline: "2026-10-17" }, now)).toEqual({ text: "0 d", tone: "near" });
  });

  it("marks a deadline before today as passed", () => {
    expect(deadlineText({ deadline: "2026-10-16" }, now)).toEqual({ text: "passed", tone: "passed" });
  });

  it("returns nothing without a deadline or with one that is not a calendar date", () => {
    expect(deadlineText(undefined, now)).toBeUndefined();
    expect(deadlineText({ venue: "ICLR" }, now)).toBeUndefined();
    expect(deadlineText({ deadline: "soon" }, now)).toBeUndefined();
    expect(deadlineText({ deadline: "2026-02-31" }, now)).toBeUndefined();
  });
});
