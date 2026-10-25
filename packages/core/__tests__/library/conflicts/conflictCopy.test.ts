import { formatConflictOwnerLabel, deriveConflictResolutions, type ConflictCopy } from "@labshelf/core";

describe("conflictOwnerLabel", () => {
  it("labels a Space by its id and ignores a title", () => {
    expect(formatConflictOwnerLabel({ kind: "space", id: "s1" })).toBe("Space s1");
    expect(formatConflictOwnerLabel({ kind: "space", id: "s1" }, "Title")).toBe("Space s1");
  });

  it("labels a paper by its title, else its id", () => {
    expect(formatConflictOwnerLabel({ kind: "paper", id: "p" }, "Attention")).toBe("Attention");
    expect(formatConflictOwnerLabel({ kind: "paper", id: "p" })).toBe("p");
  });

  it("labels a project by its id", () => {
    expect(formatConflictOwnerLabel({ kind: "project", id: "w" })).toBe("w");
  });
});

function copyOf(original: string): ConflictCopy {
  return { owner: { kind: "paper", id: "p" }, original, copy: `${original}.conflict`, tool: "syncthing" };
}

describe("conflictResolutions", () => {
  it("offers all three resolutions for an ordinary file", () => {
    expect(deriveConflictResolutions(copyOf("/lib/papers/p/paper.pdf"))).toEqual(["keepMine", "keepOther", "keepBoth"]);
  });

  it("leaves out keepBoth for metadata.yaml, on POSIX and Windows paths", () => {
    expect(deriveConflictResolutions(copyOf("/lib/papers/p/metadata.yaml"))).toEqual(["keepMine", "keepOther"]);
    expect(deriveConflictResolutions(copyOf("C:\\lib\\papers\\p\\metadata.yaml"))).toEqual(["keepMine", "keepOther"]);
  });

  it("leaves out keepBoth for a paper's notes.qmd only", () => {
    expect(deriveConflictResolutions(copyOf("/lib/.research/papers/p/notes.qmd"))).toEqual(["keepMine", "keepOther"]);
    const project: ConflictCopy = { owner: { kind: "project", id: "w" }, original: "/lib/projects/w/notes.qmd", copy: "/lib/projects/w/notes.qmd.conflict1", tool: "rclone" };
    expect(deriveConflictResolutions(project)).toEqual(["keepMine", "keepOther", "keepBoth"]);
  });
});

describe("conflictResolutions for Space files", () => {
  it("leaves out keepBoth for space.json and glossary.json", () => {
    for (const file of ["space.json", "glossary.json"]) {
      const conflict: ConflictCopy = { owner: { kind: "space", id: "s" }, original: `/lib/spaces/s/${file}`, copy: `/lib/spaces/s/${file}.conflict1`, tool: "rclone" };
      expect(deriveConflictResolutions(conflict)).toEqual(["keepMine", "keepOther"]);
    }
  });
});
