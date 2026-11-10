import { conflictCopyPath, parseConflictName } from "../../../src/library/conflicts/index";

describe("parseConflictName", () => {
  it.each([
    ["paper.sync-conflict-20240301-123456-ABCDEFG.pdf", "paper.pdf", "syncthing"],
    ["data.sync-conflict-20240301-123456-ABC1234.json", "data.json", "syncthing"],
    ["notes.sync-conflict-20240301-123456-ABCDEFG", "notes", "syncthing"],
    ["metadata (conflicted copy 2018-04-10 093612).yaml", "metadata.yaml", "nextcloud"],
    ["metadata (conflicted copy alice 2018-04-10 093612).yaml", "metadata.yaml", "nextcloud"],
    ["notes (conflicted copy 2018-04-10 093612)", "notes", "nextcloud"],
    ["paper (Alice's conflicted copy 2024-03-01).pdf", "paper.pdf", "dropbox"],
    ["paper (Alice Smith's conflicted copy 2024-03-01 (1)).pdf", "paper.pdf", "dropbox"],
    ["data.json.conflict1", "data.json", "rclone"],
    ["data.json.conflict2", "data.json", "rclone"],
    ["figure.conflict2.png", "figure.png", "rclone"],
    ["data.json.path1", "data.json", "rclone"],
    ["data.json..path2", "data.json", "rclone"],
  ])("reads %s as a conflict copy of %s (%s)", (name, original, tool) => {
    expect(parseConflictName(name)).toEqual({ original, tool });
  });

  it.each([
    "paper.pdf",
    "metadata.yaml",
    "data.json",
    "paper (1).pdf",
    "paper 2.pdf",
    "paper-MacBook.pdf",
    "paper (copy 1).pdf",
    "paper.sync-conflict-2024-123456-ABCDEFG.pdf",
    "paper.sync-conflict-20240301-123456-abc.pdf",
    "metadata (conflicted copy 2018-04-10).yaml",
    "my conflicted copy notes.txt",
    "paper (Case Conflict).pdf",
    "results.conflict.csv",
    "path1",
    ".sync-conflict-20240301-123456-ABCDEFG.pdf",
  ])("does not read %s as a conflict copy", (name) => {
    expect(parseConflictName(name)).toBeNull();
  });
});

describe("conflictCopyPath", () => {
  it("names a copy the app pattern reads back as the original", () => {
    const copy = conflictCopyPath("papers/a/notes.qmd");
    expect(copy).toMatch(/^papers\/a\/notes\.qmd\.labshelf-conflict-/);
    expect(parseConflictName(copy.split("/").pop()!)).toEqual({ original: "notes.qmd", tool: "app" });
  });

  it("uses the given id", () => {
    expect(conflictCopyPath("x.txt", "0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("x.txt.labshelf-conflict-0f8fad5b-d9cb-469f-a165-70867728950e");
  });
});
