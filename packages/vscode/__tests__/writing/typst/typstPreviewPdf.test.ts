// Tests the preview PDF's name and place: inside the project's build folder, named after the main file.
import * as path from "node:path";

import { typstPreviewPdf } from "../../../src/writing/typst/typstPreviewPdf";
import { readyEntry } from "../../support/writingFixtures";

type Project = Parameters<typeof typstPreviewPdf>[0];
const data = { projectBuildDir: (id: string) => path.join(path.sep, "cache", id) };

describe("typstPreviewPdf", () => {
  it("names the preview after the main file inside the project's build folder", () => {
    const project = readyEntry("/p/paper", { main: "src/thesis.typ" }) as Project;
    expect(typstPreviewPdf(project, data, path)).toBe(path.join(path.sep, "cache", "paper", "thesis.pdf"));
  });

  it("keeps the dots of a main name that has them", () => {
    const project = readyEntry("/p/paper", { main: "a.b.typ" }) as Project;
    expect(typstPreviewPdf(project, data, path)).toBe(path.join(path.sep, "cache", "paper", "a.b.pdf"));
  });
});
