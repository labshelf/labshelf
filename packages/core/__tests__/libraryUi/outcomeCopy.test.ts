import { cleanTags, keptFieldNotice, moveNotice, papersLabel, removeNotice } from "../../src/libraryUi/outcomeCopy";

const titleOf = (id: string): string => `Title ${id}`;

describe("papersLabel and cleanTags", () => {
  it("pluralises and trims", () => {
    expect(papersLabel(1)).toBe("1 paper");
    expect(papersLabel(3)).toBe("3 papers");
    expect(cleanTags([" ml ", "", "  "])).toEqual(["ml"]);
  });
});

describe("keptFieldNotice", () => {
  it("counts the papers and names the field and the reason", () => {
    expect(keptFieldNotice("tags", 1, "locked")).toBe("1 paper kept their tags — locked");
    expect(keptFieldNotice("status", 2, "not found")).toBe("2 papers kept their status — not found");
  });
});

describe("moveNotice", () => {
  it("counts the moved papers and names the folder, the root as All papers", () => {
    expect(moveNotice(2, [], "Thesis", titleOf)).toEqual({ kind: "ok", text: "2 papers moved to Thesis" });
    expect(moveNotice(1, [], undefined, titleOf)).toEqual({ kind: "ok", text: "1 paper moved to All papers" });
  });

  it("names the first paper that failed", () => {
    expect(moveNotice(1, [{ id: "p2", error: "exists" }], "B", titleOf))
      .toEqual({ kind: "error", text: '1 moved, 1 failed — "Title p2" — exists' });
  });

  it("says nothing when nothing happened", () => {
    expect(moveNotice(0, [], "B", titleOf)).toBeUndefined();
  });
});

describe("removeNotice", () => {
  it("names a single paper and counts several", () => {
    expect(removeNotice(["p1"], [], titleOf)).toEqual({ kind: "ok", text: 'Removed "Title p1"' });
    expect(removeNotice(["p1", "p2"], [], titleOf)).toEqual({ kind: "ok", text: "Removed 2 papers" });
  });

  it("names the first paper that failed", () => {
    expect(removeNotice([], [{ id: "p3", error: "busy" }], titleOf))
      .toEqual({ kind: "error", text: '0 removed, 1 failed — "Title p3" — busy' });
  });

  it("says nothing when nothing happened", () => {
    expect(removeNotice([], [], titleOf)).toBeUndefined();
  });
});
