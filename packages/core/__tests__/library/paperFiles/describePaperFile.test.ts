// Tests that describing one file of a paper sets, clears and prunes descriptions in the `files` map.
import { describePaperFile } from "../../../src/library/paperFiles";

const onDisk = ["paper.pdf", "notes.md", "data"];

describe("describePaperFile", () => {
  it("sets a trimmed description on a file that is on disk", () => {
    expect(describePaperFile(undefined, "notes.md", "  My notes \n", onDisk)).toEqual({ "notes.md": "My notes" });
  });

  it("replaces an existing description and keeps the others", () => {
    expect(describePaperFile({ "notes.md": "old", data: "Raw" }, "notes.md", "new", onDisk)).toEqual({ "notes.md": "new", data: "Raw" });
  });

  it("removes the description when it is empty or blank", () => {
    expect(describePaperFile({ "notes.md": "old", data: "Raw" }, "notes.md", "", onDisk)).toEqual({ data: "Raw" });
    expect(describePaperFile({ "notes.md": "old", data: "Raw" }, "notes.md", "   ", onDisk)).toEqual({ data: "Raw" });
  });

  it("drops descriptions of names that are no longer on disk", () => {
    expect(describePaperFile({ "gone.txt": "stale", data: "Raw" }, "notes.md", "x", onDisk)).toEqual({ data: "Raw", "notes.md": "x" });
  });

  it("returns an empty map when no description is left", () => {
    expect(describePaperFile({ "notes.md": "old" }, "notes.md", "", onDisk)).toEqual({});
    expect(describePaperFile(undefined, "notes.md", "  ", onDisk)).toEqual({});
    expect(describePaperFile({ "gone.txt": "stale" }, "notes.md", "", onDisk)).toEqual({});
  });

  it("does not describe a name that is not on disk", () => {
    expect(describePaperFile(undefined, "missing.txt", "x", onDisk)).toBeUndefined();
  });

  it("does not change the map it is given", () => {
    const files = { "notes.md": "old" };
    describePaperFile(files, "notes.md", "new", onDisk);
    expect(files).toEqual({ "notes.md": "old" });
  });
});
