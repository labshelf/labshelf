import { parseConflictName } from "../../../src/library/conflicts/index";

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
