// Tests the page limit the build roots message carries from the project's check settings.
import * as path from "node:path";

import { previewRootsMessage } from "../../../../src/writing/preview/roots";
import type { ReadyProject } from "../../../../src/writing/mainDocument";
import { fakeProjectData, readyEntry } from "../../../support/writingFixtures";

function input(check?: { pages?: number; anonymous: boolean }) {
  const base = readyEntry("/lib/paper") as ReadyProject;
  const project = { ...base, settings: { ...base.settings, ...(check ? { check } : {}) } } as ReadyProject;
  return {
    project, built: ["/lib/paper/main.tex"], focused: "/lib/paper/main.tex", shown: "/lib/paper/main.tex",
    problemsOf: () => [], failed: () => false, paths: path, data: fakeProjectData(),
  };
}

describe("previewRootsMessage page limit", () => {
  it("carries check.pages as pageLimit", async () => {
    expect((await previewRootsMessage(input({ pages: 9, anonymous: true }))).pageLimit).toBe(9);
  });

  it("omits pageLimit when the project sets no page limit", async () => {
    expect("pageLimit" in (await previewRootsMessage(input({ anonymous: true })))).toBe(false);
    expect("pageLimit" in (await previewRootsMessage(input()))).toBe(false);
  });
});
