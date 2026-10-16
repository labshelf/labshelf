import { lastReadPaper } from "../../src/library-ui/lastReadPaper";

describe("lastReadPaper", () => {
  it("picks the paper with the newest reading position", () => {
    expect(lastReadPaper({
      a: { annotations: 0, lastPage: 3, lastRead: "2026-01-01T10:00:00.000Z" },
      b: { annotations: 2, lastPage: 6, lastRead: "2026-01-02T10:00:00.000Z" },
      c: { annotations: 1 },
    })).toEqual({ paperId: "b", page: 6, readAt: "2026-01-02T10:00:00.000Z" });
  });

  it("compares instants, not strings", () => {
    expect(lastReadPaper({
      a: { annotations: 0, lastPage: 1, lastRead: "2026-01-01T10:00:00+02:00" },
      b: { annotations: 0, lastPage: 2, lastRead: "2026-01-01T09:00:00Z" },
    })?.paperId).toBe("b");
  });

  it("skips unreadable timestamps and returns undefined when nothing was read", () => {
    expect(lastReadPaper({ a: { annotations: 1, lastPage: 2, lastRead: "yesterday" }, b: { annotations: 0 } })).toBeUndefined();
    expect(lastReadPaper({})).toBeUndefined();
  });
});
