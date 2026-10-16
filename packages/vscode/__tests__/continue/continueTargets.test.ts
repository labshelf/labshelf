// Verifies that the Continue row picks the newest paper and project file, skips what is gone and survives a failing part.
import * as path from "node:path";

import * as vscode from "vscode";

import type { PaperRecord, ProjectCursor } from "@labshelf/core";

import { readContinueTargets, type ContinueLibrary } from "../../src/continue/continueTargets";
import type { WritingProjects } from "../../src/writing";
import { fakeLogger, fakeProjects, readyEntry } from "../support/writingFixtures";

const record = (id: string, title: string): PaperRecord => ({ id, title }) as PaperRecord;
const sidecars: Record<string, unknown> = {
  old: { annotations: [], reading: { page: 2, updatedAt: "2026-01-01T00:00:00.000Z" } },
  recent: { annotations: [], reading: { page: 6, updatedAt: "2026-02-01T00:00:00.000Z" } },
  unread: { annotations: [] },
};

function library(over: Partial<ContinueLibrary> = {}): ContinueLibrary {
  return {
    root: "/lib",
    logger: fakeLogger(),
    listPapers: async () => [record("old", "Old paper"), record("recent", "Recent paper"), record("unread", "Unread")],
    loadSidecar: async (id) => sidecars[id] as never,
    ...over,
  };
}

const dir = "/lib/projects/survey";

/** The store whose project data reports `cursor` as the latest edit of the first project. */
function asStore(entries = [] as ReturnType<typeof readyEntry>[], cursor?: ProjectCursor): WritingProjects {
  const projects = fakeProjects(entries);
  const first = entries[0];
  if (cursor && first?.kind === "ready") { projects.data.latestProjectEdit.mockResolvedValue({ id: first.settings.id, folder: first.folder, cursor }); }
  return projects as unknown as WritingProjects;
}

const stat = vscode.workspace.fs.stat as jest.Mock;
afterEach(() => { stat.mockImplementation(async () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 })); });

describe("readContinueTargets", () => {
  it("offers nothing without a library or without anything read or edited", async () => {
    expect(await readContinueTargets(undefined, asStore())).toEqual([]);
    expect(await readContinueTargets(library({ loadSidecar: async () => ({ annotations: [] }) }), asStore())).toEqual([]);
  });

  it("offers the paper read last, with its page", async () => {
    expect(await readContinueTargets(library(), asStore())).toEqual([{ kind: "paper", paperId: "recent", title: "Recent paper", page: 6 }]);
  });

  it("offers the project edited last at its saved cursor, when the file still exists", async () => {
    stat.mockResolvedValue({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 });
    const cursor = { file: "sec/a.tex", line: 4, character: 2, updatedAt: "2026-03-01T00:00:00.000Z" };
    const entries = [readyEntry(dir, { settings: { id: "survey", format: "latex" } as never })];
    const targets = await readContinueTargets(library({ loadSidecar: async () => ({ annotations: [] }) }), asStore(entries, cursor));
    expect(stat).toHaveBeenCalledWith(expect.objectContaining({ fsPath: path.join(dir, "sec", "a.tex") }));
    expect(targets).toEqual([{ kind: "project", projectId: "survey", file: path.join(dir, "sec", "a.tex"), relativeFile: "sec/a.tex", line: 4, character: 2 }]);

    stat.mockRejectedValueOnce(Object.assign(new Error("FileNotFound"), { code: "FileNotFound" }));
    expect(await readContinueTargets(library({ loadSidecar: async () => ({ annotations: [] }) }), asStore(entries, cursor))).toEqual([]);
  });

  it("skips a project path that is a directory", async () => {
    const cursor = { file: "sec", line: 0, character: 0, updatedAt: "2026-03-01T00:00:00.000Z" };
    stat.mockResolvedValue({ type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 });
    const targets = await readContinueTargets(library({ loadSidecar: async () => ({ annotations: [] }) }), asStore([readyEntry(dir)], cursor));
    expect(targets).toEqual([]);
  });

  it("logs a part that fails and still offers the other", async () => {
    const lib = library({ listPapers: async () => { throw new Error("index"); } });
    const cursor = { file: "main.tex", line: 0, character: 0, updatedAt: "2026-03-01T00:00:00.000Z" };
    stat.mockResolvedValue({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 });
    const targets = await readContinueTargets(lib, asStore([readyEntry(dir)], cursor));
    expect(targets.map((t) => t.kind)).toEqual(["project"]);
    expect(lib.logger.error).toHaveBeenCalledWith("continue", expect.any(Error), { part: "paper" });
  });
});
