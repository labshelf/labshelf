// Tests which project owns a file and the relative main path stored for it.
import * as path from "node:path";

import { deriveBuildRootPath, findOwningProject } from "../../src/writing/buildRootDocument";
import { readyEntry } from "../support/writingFixtures";

describe("findOwningProject", () => {
  const outer = readyEntry("/code/repo");
  const inner = readyEntry("/code/repo/paper");

  it("picks the deepest project folder that contains the file", () => {
    expect(findOwningProject({ list: () => [outer, inner], paths: path }, "/code/repo/paper/sections/intro.tex")).toBe(inner);
    expect(findOwningProject({ list: () => [inner, outer], paths: path }, "/code/repo/paper/main.tex")).toBe(inner);
    expect(findOwningProject({ list: () => [outer, inner], paths: path }, "/code/repo/notes.typ")).toBe(outer);
  });

  it("finds nothing for a file outside every project, in a sibling with the same prefix, or in a broken project", () => {
    expect(findOwningProject({ list: () => [outer], paths: path }, "/code/other/main.tex")).toBeUndefined();
    expect(findOwningProject({ list: () => [outer], paths: path }, "/code/repository/main.tex")).toBeUndefined();
    expect(findOwningProject({ list: () => [{ kind: "broken", folder: "/code/repo", location: "external", reason: "x" }], paths: path }, "/code/repo/main.tex")).toBeUndefined();
    expect(findOwningProject({ list: () => [], paths: path }, "/code/repo/main.tex")).toBeUndefined();
  });
});

describe("deriveBuildRootPath", () => {
  it("is relative to the project folder with forward slashes", () => {
    const project = readyEntry(path.join("/code", "repo")) as Parameters<typeof deriveBuildRootPath>[1];
    expect(deriveBuildRootPath(path, project, path.join("/code", "repo", "src", "main.tex"))).toBe("src/main.tex");
    expect(deriveBuildRootPath(path, project, path.join("/code", "repo", "main.tex"))).toBe("main.tex");
  });
});
