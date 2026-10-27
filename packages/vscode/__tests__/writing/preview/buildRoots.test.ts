// Tests the build roots module: the roots message (limits and chrome fields), the preprint problems of the user's .bib files and the sources of a root.
import * as path from "node:path";
import * as vscode from "vscode";

import { BIBLIOGRAPHY_HEADER } from "@labshelf/core";
import { createPreviewBuildRootsMessage, createProjectPreprints, createProjectSources } from "../../../src/writing/preview/buildRoots";
import { fakeDocument } from "../../support/textDocument";
import { fakeLogger, fakeProjectData, readyEntry } from "../../support/writingFixtures";

import type { ReadyProject } from "../../../src/writing/buildRootDocument";

describe("roots message", () => {
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
      expect((await createPreviewBuildRootsMessage(input({ pages: 9, anonymous: true }))).pageLimit).toBe(9);
    });

    it("carries check.words as wordLimit", async () => {
      expect((await createPreviewBuildRootsMessage(input({ words: 6000, anonymous: true }))).wordLimit).toBe(6000);
    });

    it("carries check.countUpTo as countUpTo", async () => {
      expect((await createPreviewBuildRootsMessage(input({ countUpTo: "conclusion", anonymous: true }))).countUpTo).toBe("conclusion");
    });

    it("omits the limits when the project sets none", async () => {
      for (const message of [await createPreviewBuildRootsMessage(input({ anonymous: true })), await createPreviewBuildRootsMessage(input())]) {
        for (const field of ["pageLimit", "wordLimit", "countUpTo", "checks", "options"]) { expect(field in message).toBe(false); }
      }
    });
  });

  describe("previewRootsMessage chrome fields", () => {
    it("carries the build options", async () => {
      const options = { autoCompile: "typing" as const, engine: null };
      expect((await createPreviewBuildRootsMessage({ ...input(), options })).options).toEqual(options);
    });

    it("carries the findings of the last check", async () => {
      expect((await createPreviewBuildRootsMessage({ ...input(), checks: 0 })).checks).toBe(0);
    });

    it("fills pdfProblems, cites and words per built root", async () => {
      const [root] = (await createPreviewBuildRootsMessage(input())).roots;
      expect(root).toMatchObject({ pdfProblems: [PDF_PROBLEM], cites: 4, words: 1200 });
    });

    it("leaves pdfProblems and cites absent and logs when placing the problems fails", async () => {
      const logger = fakeLogger();
      const failing = async () => { throw new Error("no synctex"); };
      const [root] = (await createPreviewBuildRootsMessage({ ...input(), logger, pdfProblemsOf: failing })).roots;
      expect(root).toMatchObject({ words: 1200 });
      expect(root).not.toHaveProperty("pdfProblems");
      expect(root).not.toHaveProperty("cites");
      expect(logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ root: ROOT }));
    });

    it("leaves words absent when counting fails", async () => {
      const failing = async () => { throw new Error("unreadable"); };
      const [root] = (await createPreviewBuildRootsMessage({ ...input(), wordsOf: failing })).roots;
      expect(root).not.toHaveProperty("words");
      expect(root).toMatchObject({ cites: 4 });
    });
  });
});

describe("project preprints", () => {
  const workspace = vscode.workspace as unknown as Record<string, jest.Mock>;
  const PREPRINT = "@article{vaswani2017,\n  title = {Attention},\n  doi = {10.1/x},\n  eprint = {1706.03762},\n  archivePrefix = {arXiv}\n}\n";
  const project = readyEntry("/proj") as ReadyProject;
  const lookup = jest.fn(async () => ({ doi: "10.5555/attn", record: { title: "Attention", journal: "NeurIPS", authors: ["Vaswani, A."], year: 2017 } }));

  function listBibs(documents: Record<string, string>): void {
    const byPath = new Map(Object.entries(documents).map(([file, text]) => [file, fakeDocument(file, text)]));
    workspace.findFiles = jest.fn(async () => [...byPath.keys()].map((file) => vscode.Uri.file(file)));
    workspace.openTextDocument = jest.fn(async (uri: vscode.Uri) => byPath.get(uri.fsPath));
  }

  describe("createProjectPreprints", () => {
    it("reports the preprint of a user .bib with its file and line, and skips the generated file", async () => {
      listBibs({ "/proj/labshelf.bib": `${BIBLIOGRAPHY_HEADER}\n\n${PREPRINT}`, "/proj/refs.bib": `% refs\n\n${PREPRINT}` });
      const found = await createProjectPreprints({ logger: () => undefined, lookup: lookup as never })(project);
      expect(found).toEqual([expect.objectContaining({ key: "vaswani2017", file: "/proj/refs.bib", line: 3, message: expect.any(String) })]);
    });

    it("logs and answers nothing when the .bib files cannot be read", async () => {
      workspace.findFiles = jest.fn(async () => { throw new Error("denied"); });
      const logger = fakeLogger();
      expect(await createProjectPreprints({ logger: () => logger, lookup: lookup as never })(project)).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ projectFolder: "/proj" }));
    });
  });
});

describe("project sources", () => {
  const FILES: Record<string, string> = { "main.tex": "\\input{intro}", "intro.tex": "hello", "main.typ": '#include "intro.typ"', "intro.typ": "hello" };
  const readerFor = () => ({ read: async (file: string) => FILES[file] });

  function project(format: "latex" | "typst"): ReadyProject {
    const base = readyEntry("/lib/paper") as ReadyProject;
    return { ...base, settings: { ...base.settings, format } } as ReadyProject;
  }

  describe("walkProjectSources", () => {
    it("reads a LaTeX root with the files it includes", async () => {
      const sources = await createProjectSources(readerFor)(project("latex"), "main.tex");
      expect(sources.map((source) => source.file)).toEqual(["main.tex", "intro.tex"]);
    });

    it("reads a Typst root alone", async () => {
      const sources = await createProjectSources(readerFor)(project("typst"), "main.typ");
      expect(sources).toEqual([{ file: "main.typ", text: '#include "intro.typ"' }]);
    });

    it("leaves out a Typst root that cannot be read", async () => {
      expect(await createProjectSources(readerFor)(project("typst"), "gone.typ")).toEqual([]);
    });
  });
});
