import { conflictResolutions, type ConflictCopy } from "@labshelf/core";

function copyOf(original: string): ConflictCopy {
  return { owner: { kind: "paper", id: "p" }, original, copy: `${original}.conflict`, tool: "syncthing" };
}

describe("conflictResolutions", () => {
  it("offers all three resolutions for an ordinary file", () => {
    expect(conflictResolutions(copyOf("/lib/papers/p/paper.pdf"))).toEqual(["keepMine", "keepOther", "keepBoth"]);
  });

  it("leaves out keepBoth for metadata.yaml, on POSIX and Windows paths", () => {
    expect(conflictResolutions(copyOf("/lib/papers/p/metadata.yaml"))).toEqual(["keepMine", "keepOther"]);
    expect(conflictResolutions(copyOf("C:\\lib\\papers\\p\\metadata.yaml"))).toEqual(["keepMine", "keepOther"]);
  });
});
