// Tests the sentences of the All projects detail pane: meta line, venue line, limit sentence and build status.
import { formatProjectBuildStateText, describeLimits, formatMetaLine, formatProjectVenueLine } from "../../../../../src/writing/allProjects/dom/detailPane/projectDetailPaneText";
import { NOW, detail, row } from "./fixtures";

describe("formatMetaLine", () => {
  it("joins format, main file, pages and modified time", () => {
    expect(formatMetaLine(row, 8, NOW)).toBe("LaTeX · main.tex · 8 pages · modified 2 h ago");
  });

  it("leaves out what the row does not know", () => {
    expect(formatMetaLine({ id: "x", title: "t", place: "projects", format: "typst" }, undefined, NOW)).toBe("Typst");
  });
});

describe("formatProjectVenueLine", () => {
  it("says the venue and the days until the deadline", () => {
    expect(formatProjectVenueLine(row.target, NOW)).toBe("ICLR 2027 · due in 41 days");
  });

  it("handles today, a passed deadline, a venue alone and nothing", () => {
    expect(formatProjectVenueLine({ venue: "NeurIPS", deadline: "2026-10-17" }, NOW)).toBe("NeurIPS · due today");
    expect(formatProjectVenueLine({ deadline: "2026-10-16" }, NOW)).toBe("deadline passed");
    expect(formatProjectVenueLine({ venue: "NeurIPS" }, NOW)).toBe("NeurIPS");
    expect(formatProjectVenueLine(undefined, NOW)).toBeUndefined();
  });
});

describe("describeLimits", () => {
  it("counts the pages left and names the counting scope", () => {
    expect(describeLimits(detail.limits)).toBe("1 page left · counted up to the references");
    expect(describeLimits({ countUpTo: "end", pages: { counted: 9, limit: 9 } })).toBe("At the limit · counted to the end");
    expect(describeLimits({ countUpTo: "end", pages: { counted: 11, limit: 9 } })).toBe("2 pages over · counted to the end");
  });

  it("falls back to a word limit and says nothing without any limit", () => {
    expect(describeLimits({ countUpTo: "end", words: { counted: 7_900, limit: 8_000 } })).toBe("100 words left · counted to the end");
    expect(describeLimits({ countUpTo: "end", pages: { counted: 8 } })).toBeUndefined();
  });
});

describe("formatBuildStateText", () => {
  it("names the four outcomes", () => {
    expect(formatProjectBuildStateText({ state: "warnings", warnings: 2 })).toBe("2 warnings");
    expect(formatProjectBuildStateText({ state: "ok" })).toBe("Built");
    expect(formatProjectBuildStateText({ state: "failed" })).toBe("Build failed");
    expect(formatProjectBuildStateText(undefined)).toBe("Never built");
  });
});
