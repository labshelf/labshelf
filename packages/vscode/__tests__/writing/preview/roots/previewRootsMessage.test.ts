// Tests the build roots message: the limits from the check settings and what the chrome needs per root.
import * as path from "node:path";

import { previewRootsMessage } from "../../../../src/writing/preview/roots";
import type { ReadyProject } from "../../../../src/writing/mainDocument";
import { fakeLogger, fakeProjectData, readyEntry } from "../../../support/writingFixtures";

const ROOT = "main.tex";
const PDF_PROBLEM = { kind: "undefinedCitation", severity: "error", message: "Unknown cite", subject: "doe" };

function input(check?: Record<string, unknown>) {
  const base = readyEntry("/lib/paper") as ReadyProject;
  const project = { ...base, settings: { ...base.settings, ...(check ? { check } : {}) } } as ReadyProject;
  return {
    project, built: [ROOT], focused: ROOT, shown: ROOT,
    problemsOf: () => [], failed: () => false, paths: path, data: fakeProjectData(),
    pdfProblemsOf: async () => ({ pdfProblems: [PDF_PROBLEM] as never, cites: 4 }),
    wordsOf: async () => 1200,
  };
}

describe("previewRootsMessage limits", () => {
  it("carries check.pages as pageLimit", async () => {
    expect((await previewRootsMessage(input({ pages: 9, anonymous: true }))).pageLimit).toBe(9);
  });

  it("carries check.words as wordLimit", async () => {
    expect((await previewRootsMessage(input({ words: 6000, anonymous: true }))).wordLimit).toBe(6000);
  });

  it("carries check.countUpTo as countUpTo", async () => {
    expect((await previewRootsMessage(input({ countUpTo: "conclusion", anonymous: true }))).countUpTo).toBe("conclusion");
  });

  it("omits the limits when the project sets none", async () => {
    for (const message of [await previewRootsMessage(input({ anonymous: true })), await previewRootsMessage(input())]) {
      for (const field of ["pageLimit", "wordLimit", "countUpTo", "checks", "options"]) { expect(field in message).toBe(false); }
    }
  });
});

describe("previewRootsMessage chrome fields", () => {
  it("carries the build options", async () => {
    const options = { autoCompile: "typing" as const, engine: null };
    expect((await previewRootsMessage({ ...input(), options })).options).toEqual(options);
  });

  it("carries the findings of the last check", async () => {
    expect((await previewRootsMessage({ ...input(), checks: 0 })).checks).toBe(0);
  });

  it("fills pdfProblems, cites and words per built root", async () => {
    const [root] = (await previewRootsMessage(input())).roots;
    expect(root).toMatchObject({ pdfProblems: [PDF_PROBLEM], cites: 4, words: 1200 });
  });

  it("leaves pdfProblems and cites absent and logs when placing the problems fails", async () => {
    const logger = fakeLogger();
    const failing = async () => { throw new Error("no synctex"); };
    const [root] = (await previewRootsMessage({ ...input(), logger, pdfProblemsOf: failing })).roots;
    expect(root).toMatchObject({ words: 1200 });
    expect(root).not.toHaveProperty("pdfProblems");
    expect(root).not.toHaveProperty("cites");
    expect(logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ root: ROOT }));
  });

  it("leaves words absent when counting fails", async () => {
    const failing = async () => { throw new Error("unreadable"); };
    const [root] = (await previewRootsMessage({ ...input(), wordsOf: failing })).roots;
    expect(root).not.toHaveProperty("words");
    expect(root).toMatchObject({ cites: 4 });
  });
});
