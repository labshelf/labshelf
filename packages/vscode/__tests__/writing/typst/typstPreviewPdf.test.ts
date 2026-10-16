// Tests the preview PDF's name and place: inside the build folder of its root, named after the root file.
import * as path from "node:path";

import { rootBuildFolder } from "@labshelf/core";
import { typstPreviewPdf } from "../../../src/writing/typst/typstPreviewPdf";
import { readyEntry } from "../../support/writingFixtures";

type Project = Parameters<typeof typstPreviewPdf>[0];
const data = { projectBuildDir: (id: string) => path.join(path.sep, "cache", id) };
const buildDir = data.projectBuildDir("paper");
const project = readyEntry("/p/paper", { main: "main.typ", settings: { id: "paper", format: "typst" } }) as Project;

describe("typstPreviewPdf", () => {
  it("names the preview after the root file inside the root's build folder", () => {
    expect(typstPreviewPdf(project, "src/thesis.typ", data, path)).toBe(path.join(buildDir, rootBuildFolder("src/thesis.typ"), "thesis.pdf"));
  });

  it("keeps the dots of a root name that has them", () => {
    expect(typstPreviewPdf(project, "a.b.typ", data, path)).toBe(path.join(buildDir, rootBuildFolder("a.b.typ"), "a.b.pdf"));
  });

  it("gives roots with the same name in different folders different PDFs", () => {
    const first = typstPreviewPdf(project, "a/main.typ", data, path);
    const second = typstPreviewPdf(project, "b/main.typ", data, path);
    expect(first).not.toBe(second);
    expect(path.basename(first)).toBe("main.pdf");
    expect(path.basename(second)).toBe("main.pdf");
  });
});
