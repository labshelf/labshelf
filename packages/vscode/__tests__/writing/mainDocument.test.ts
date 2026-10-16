// Tests which project owns a file and the relative main path stored for it.
import * as path from "node:path";

import { mainPathIn, owningProject } from "../../src/writing/mainDocument";
import { readyEntry } from "../support/writingFixtures";

describe("owningProject", () => {
  const outer = readyEntry("/code/repo");
  const inner = readyEntry("/code/repo/paper");

  it("picks the deepest project folder that contains the file", () => {
    expect(owningProject([outer, inner], "/code/repo/paper/sections/intro.tex")).toBe(inner);
    expect(owningProject([inner, outer], "/code/repo/paper/main.tex")).toBe(inner);
    expect(owningProject([outer, inner], "/code/repo/notes.typ")).toBe(outer);
  });

  it("finds nothing for a file outside every project, in a sibling with the same prefix, or in a broken project", () => {
    expect(owningProject([outer], "/code/other/main.tex")).toBeUndefined();
    expect(owningProject([outer], "/code/repository/main.tex")).toBeUndefined();
    expect(owningProject([{ kind: "broken", folder: "/code/repo", location: "external", reason: "x" }], "/code/repo/main.tex")).toBeUndefined();
    expect(owningProject([], "/code/repo/main.tex")).toBeUndefined();
  });
});

describe("mainPathIn", () => {
  it("is relative to the project folder with forward slashes", () => {
    const project = readyEntry(path.join("/code", "repo")) as Parameters<typeof mainPathIn>[0];
    expect(mainPathIn(project, path.join("/code", "repo", "src", "main.tex"))).toBe("src/main.tex");
    expect(mainPathIn(project, path.join("/code", "repo", "main.tex"))).toBe("main.tex");
  });
});
