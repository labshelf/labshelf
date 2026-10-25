/** Verifies the built PDF is named next to its root file with "/" project paths. */
import { posixPathOps } from "../../../src/library/index";
import { deriveBuiltPdfPath } from "../../../src/writing/build/index";
import type { ProjectEntry } from "../../../src/writing/project/index";

type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

const project = (main: string | null): ReadyEntry =>
  ({ kind: "ready", folder: "/lib/projects/p", main: main ?? undefined, settings: { id: "p", format: "latex" } }) as unknown as ReadyEntry;

describe("deriveBuiltPdfPath", () => {
  it("names <root>.pdf next to the root, the main file by default, and nothing without a root", () => {
    expect(deriveBuiltPdfPath(posixPathOps, project("main.tex"))).toBe("/lib/projects/p/main.pdf");
    expect(deriveBuiltPdfPath(posixPathOps, project("main.tex"), "chapters/intro.tex")).toBe("/lib/projects/p/chapters/intro.pdf");
    expect(deriveBuiltPdfPath(posixPathOps, project(null))).toBeUndefined();
  });
});
