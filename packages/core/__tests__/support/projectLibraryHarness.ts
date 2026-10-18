/** Builds a project library over an in-memory disk with mocked host functions, for the All projects library tests. */
import type { ProjectEntry } from "../../src/writing/project/index";
import { createProjectLibrary, type ProjectLibraryDeps } from "../../src/writing/allProjects/library/index";
import { posixPathOps } from "../../src/library/mutations/pathOps";
import { fakeLogger } from "./fakeLogger";
import { MemoryLibraryFs } from "./memoryLibraryFs";

export type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

export function readyEntry(folder: string, over: Partial<ReadyEntry> = {}): ReadyEntry {
  return { kind: "ready", folder, location: "library", main: "main.tex", settings: { id: folder.split("/").pop()!, format: "latex" }, ...over };
}

export function libraryHarness(entries: ProjectEntry[], over: Partial<ProjectLibraryDeps> = {}) {
  const fs = new MemoryLibraryFs();
  const logger = fakeLogger();
  const listeners: Array<() => void> = [];
  const unsubscribe = jest.fn();
  const data = {
    lastModified: jest.fn(async (_folder: string): Promise<number | undefined> => undefined),
    deleteProjectForever: jest.fn(async () => {}),
    listProjectFiles: jest.fn(async () => ["main.tex"]),
  };
  const projects = {
    find: (id: string) => entries.find((entry) => entry.folder === id),
    list: () => entries,
    update: jest.fn(async () => {}),
    reload: jest.fn(async () => {}),
  };
  const host = {
    openProject: jest.fn(async () => {}),
    createProject: jest.fn(async () => {}),
    openFile: jest.fn(async () => {}),
    build: jest.fn(async () => {}),
    preview: jest.fn(async () => {}),
    openLog: jest.fn(async () => {}),
    duplicate: jest.fn(async () => {}),
    runCommand: jest.fn(async () => {}),
    commands: jest.fn(() => []),
    newKinds: jest.fn(() => ["blank" as const]),
    openLabel: jest.fn(() => "Open in test"),
    isOpen: jest.fn(() => false),
    onChange: jest.fn((listener: () => void) => { listeners.push(listener); return unsubscribe; }),
  };
  const outcomes = { last: jest.fn((_folder: string): { ok: boolean; at: Date } | undefined => undefined) };
  const builds = { builtRoots: () => [] as string[], problemsOf: () => undefined, stateOf: () => undefined };
  const locate = {
    pdf: jest.fn(async (_project: ReadyEntry): Promise<string | undefined> => undefined),
    rawLog: jest.fn(async (_project: ReadyEntry, _root: string): Promise<string | undefined> => undefined),
  };
  const session = { root: "/lib", logger };
  const papers = [{ id: "p1" }];
  const library = createProjectLibrary({
    data, fs, paths: posixPathOps, logger, session: () => session, projects, outcomes, builds, locate, host,
    listPapers: async () => papers as never, pdfjs: {} as never, ...over,
  });
  return { library, fs, logger, data, projects, host, outcomes, locate, listeners, unsubscribe, papers, session };
}
