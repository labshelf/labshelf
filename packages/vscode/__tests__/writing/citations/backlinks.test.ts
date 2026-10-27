// Tests the citation sections cache and the project backlink index.
import { type ChecklistSource } from "@labshelf/core";
import * as path from "node:path";
import * as vscode from "vscode";
import { CitationSectionsCache, ProjectBacklinks } from "../../../src/writing/citations/backlinks";
import { type ReadyProject } from "../../../src/writing/commands/index";
import { fakeDocument } from "../../support/textDocument";
import { fakeLogger, readyEntry, fakeHost, fakeProjects } from "../../support/writingFixtures";

describe("citationSectionsCache", () => {
  const TEX = [
    "\\section{Intro}",
    "As shown \\cite{a2020}.",
    "\\section{Method}",
    "We use \\cite{b2021,a2020}.",
  ].join("\n");

  const sources = (): ChecklistSource[] => [{ path: "main.tex", format: "latex", text: TEX }];
  const project = (folder: string): ReadyProject => readyEntry(folder) as ReadyProject;

  function setup(read: () => Promise<ChecklistSource[]> = async () => sources()) {
    const listeners = new Set<(document: { uri: { fsPath: string } }) => void>();
    const dispose = jest.fn();
    const readSources = jest.fn(read);
    const onDidSaveTextDocument = jest.fn((listener: (document: { uri: { fsPath: string } }) => void) => {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); dispose(); } };
    });
    const cache = new CitationSectionsCache({ readSources, onDidSaveTextDocument: onDidSaveTextDocument as never, paths: path });
    const save = (fsPath: string): void => listeners.forEach((listener) => listener({ uri: { fsPath } }));
    return { cache, readSources, save, listeners, dispose, logger: fakeLogger() };
  }

  describe("CitationSectionsCache", () => {
    it("reads sources once for repeated requests of the same project folder", async () => {
      const { cache, readSources, logger } = setup();
      const first = await cache.get(project("/code/a"), logger);
      const second = await cache.get(project("/code/a"), logger);
      expect(readSources).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it("shares one read between concurrent requests", async () => {
      const { cache, readSources, logger } = setup();
      await Promise.all([cache.get(project("/code/a"), logger), cache.get(project("/code/a"), logger)]);
      expect(readSources).toHaveBeenCalledTimes(1);
    });

    it("caches different project folders separately", async () => {
      const { cache, readSources, logger } = setup();
      await cache.get(project("/code/a"), logger);
      await cache.get(project("/code/b"), logger);
      expect(readSources).toHaveBeenCalledTimes(2);
      await cache.get(project("/code/a"), logger);
      await cache.get(project("/code/b"), logger);
      expect(readSources).toHaveBeenCalledTimes(2);
    });

    it("drops only the entry of the folder that contains the saved file", async () => {
      const { cache, readSources, save, logger } = setup();
      await cache.get(project("/code/a"), logger);
      await cache.get(project("/code/b"), logger);
      save("/code/a/chapters/intro.tex");
      await cache.get(project("/code/b"), logger);
      expect(readSources).toHaveBeenCalledTimes(2);
      await cache.get(project("/code/a"), logger);
      expect(readSources).toHaveBeenCalledTimes(3);
    });

    it("keeps the cache when a file outside every project is saved", async () => {
      const { cache, readSources, save, logger } = setup();
      await cache.get(project("/code/a"), logger);
      save("/elsewhere/notes.tex");
      save("/code/ab/main.tex");
      await cache.get(project("/code/a"), logger);
      expect(readSources).toHaveBeenCalledTimes(1);
    });

    it("does not cache a failed read and surfaces the failure to the caller", async () => {
      let calls = 0;
      const { cache, readSources, logger } = setup(async () => {
        calls += 1;
        if (calls === 1) { throw new Error("disk gone"); }
        return sources();
      });
      await expect(cache.get(project("/code/a"), logger)).rejects.toThrow("disk gone");
      await expect(cache.get(project("/code/a"), logger)).resolves.toBeDefined();
      expect(readSources).toHaveBeenCalledTimes(2);
    });

    it("passes the project and logger to readSources", async () => {
      const { cache, readSources, logger } = setup();
      const ready = project("/code/a");
      await cache.get(ready, logger);
      expect(readSources).toHaveBeenCalledWith(ready, logger);
    });

    it("lists the sections that cite each key, in source order", async () => {
      const { cache, logger } = setup();
      const { byKey } = await cache.get(project("/code/a"), logger);
      expect(byKey.get("a2020")).toHaveLength(2);
      expect(byKey.get("b2021")).toHaveLength(1);
      expect(byKey.get("b2021")).toEqual([byKey.get("a2020")![1]]);
      expect(byKey.has("missing")).toBe(false);
    });

    it("answers the section of a zero-based line in an absolute project file", async () => {
      const { cache, logger } = setup();
      const { byKey, sectionAt } = await cache.get(project("/code/a"), logger);
      const [intro, method] = byKey.get("a2020")!;
      expect(sectionAt("/code/a/main.tex", 1)).toEqual(intro);
      expect(sectionAt("/code/a/main.tex", 3)).toEqual(method);
      expect(sectionAt("/code/a/main.tex", 2)).toEqual(method);
    });

    it("stops listening to saves when disposed", async () => {
      const { cache, listeners, dispose, logger } = setup();
      await cache.get(project("/code/a"), logger);
      cache.dispose();
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(listeners.size).toBe(0);
    });
  });
});

describe("projectBacklinks", () => {
  const workspace = vscode.workspace as unknown as {
    _fireDocumentEvent: (kind: string, document: vscode.TextDocument) => void;
    _fireTextDocumentChange: (event: { document: vscode.TextDocument }) => void;
  };
  const link = { project: "survey", file: "main.tex", line: 2, section: "Intro" };

  const created: ProjectBacklinks[] = [];

  function setup(logger = fakeLogger()) {
    const changed = new vscode.EventEmitter<void>();
    const entries = [readyEntry("/lib/projects/survey")];
    const projects = { ...fakeProjects(entries), onDidChange: changed.event };
    const build = projects.data.projectBacklinks;
    build.mockResolvedValue(new Map([["smith2020", [link]]]));
    const index = new ProjectBacklinks(projects as never, fakeHost(logger));
    const onChange = jest.fn();
    index.onDidChange(onChange);
    created.push(index);
    return { index, changed, onChange, logger, build };
  }

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    // The vscode double keeps document listeners across tests.
    for (const index of created.splice(0)) { index.dispose(); }
    jest.useRealTimers();
  });

  describe("ProjectBacklinks", () => {
    it("rebuilds once, a second after the project list changes, and reads open editors", async () => {
      const { index, changed, onChange, build } = setup();
      changed.fire();
      changed.fire();
      await jest.advanceTimersByTimeAsync(999);
      expect(build).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(build).toHaveBeenCalledTimes(1);
      expect(build.mock.calls[0]![1]).toEqual(expect.objectContaining({ text: expect.any(Function) }));
      expect(index.index().get("smith2020")).toEqual([link]);
      expect(index.projectFolder("survey")).toBe("/lib/projects/survey");
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("rebuilds when a .tex file inside a project is saved or edited, not for other files", async () => {
      const { onChange, build } = setup();
      workspace._fireDocumentEvent("save", fakeDocument("/lib/projects/survey/notes.md", ""));
      workspace._fireDocumentEvent("save", fakeDocument("/elsewhere/main.tex", ""));
      await jest.advanceTimersByTimeAsync(1000);
      expect(build).not.toHaveBeenCalled();

      workspace._fireDocumentEvent("save", fakeDocument("/lib/projects/survey/main.tex", ""));
      await jest.advanceTimersByTimeAsync(1000);
      workspace._fireTextDocumentChange({ document: fakeDocument("/lib/projects/survey/sections/intro.typ", "") });
      await jest.advanceTimersByTimeAsync(1000);
      expect(build).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("logs a failed rebuild and keeps the last index", async () => {
      const { index, changed, onChange, logger, build } = setup();
      changed.fire();
      await jest.advanceTimersByTimeAsync(1000);
      build.mockRejectedValue(new Error("disk"));
      changed.fire();
      await jest.advanceTimersByTimeAsync(1000);
      expect(logger.error).toHaveBeenCalledWith("writing/citations", expect.any(Error), { action: "rebuild" });
      expect(index.index().get("smith2020")).toEqual([link]);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("stops listening when disposed", async () => {
      const { index, changed, build } = setup();
      index.dispose();
      workspace._fireDocumentEvent("save", fakeDocument("/lib/projects/survey/main.tex", ""));
      await jest.advanceTimersByTimeAsync(1000);
      changed.fire();
      expect(build).not.toHaveBeenCalled();
    });
  });
});
