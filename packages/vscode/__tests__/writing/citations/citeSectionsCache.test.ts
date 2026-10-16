// Tests that CiteSectionsCache reads a project's sources once, per folder, and rereads after a save or a failure.
import * as path from "node:path";

import type { ChecklistSource } from "@labshelf/core";
import { CiteSectionsCache } from "../../../src/writing/citations/citeSectionsCache";
import type { ReadyProject } from "../../../src/writing/mainDocument";
import { fakeLogger, readyEntry } from "../../support/writingFixtures";

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
  const cache = new CiteSectionsCache({ readSources, onDidSaveTextDocument: onDidSaveTextDocument as never, paths: path });
  const save = (fsPath: string): void => listeners.forEach((listener) => listener({ uri: { fsPath } }));
  return { cache, readSources, save, listeners, dispose, logger: fakeLogger() };
}

describe("CiteSectionsCache", () => {
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
