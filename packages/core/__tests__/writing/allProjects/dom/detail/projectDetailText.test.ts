// Tests the sentences of the All projects detail pane: meta line, venue line, limit sentence and build status.
import { buildStatusText, limitSentence, metaLine, venueLine } from "../../../../../src/writing/allProjects/dom/detail/projectDetailText";
import { NOW, detail, row } from "./fixtures";

describe("metaLine", () => {
  it("joins format, main file, pages and modified time", () => {
    expect(metaLine(row, 8, NOW)).toBe("LaTeX · main.tex · 8 pages · modified 2 h ago");
  });

  it("leaves out what the row does not know", () => {
    expect(metaLine({ id: "x", title: "t", place: "projects", format: "typst" }, undefined, NOW)).toBe("Typst");
  });
});

describe("venueLine", () => {
  it("says the venue and the days until the deadline", () => {
    expect(venueLine(row.target, NOW)).toBe("ICLR 2027 · due in 41 days");
  });

  it("handles today, a passed deadline, a venue alone and nothing", () => {
    expect(venueLine({ venue: "NeurIPS", deadline: "2026-10-17" }, NOW)).toBe("NeurIPS · due today");
    expect(venueLine({ deadline: "2026-10-16" }, NOW)).toBe("deadline passed");
    expect(venueLine({ venue: "NeurIPS" }, NOW)).toBe("NeurIPS");
    expect(venueLine(undefined, NOW)).toBeUndefined();
  });
});

describe("limitSentence", () => {
  it("counts the pages left and names the counting scope", () => {
    expect(limitSentence(detail.limits)).toBe("1 page left · counted up to the references");
    expect(limitSentence({ countUpTo: "end", pages: { counted: 9, limit: 9 } })).toBe("At the limit · counted to the end");
    expect(limitSentence({ countUpTo: "end", pages: { counted: 11, limit: 9 } })).toBe("2 pages over · counted to the end");
  });

  it("falls back to a word limit and says nothing without any limit", () => {
    expect(limitSentence({ countUpTo: "end", words: { counted: 7_900, limit: 8_000 } })).toBe("100 words left · counted to the end");
    expect(limitSentence({ countUpTo: "end", pages: { counted: 8 } })).toBeUndefined();
  });
});

describe("buildStatusText", () => {
  it("names the four outcomes", () => {
    expect(buildStatusText({ state: "warnings", warnings: 2 })).toBe("2 warnings");
    expect(buildStatusText({ state: "ok" })).toBe("Built");
    expect(buildStatusText({ state: "failed" })).toBe("Build failed");
    expect(buildStatusText(undefined)).toBe("Never built");
  });
});
