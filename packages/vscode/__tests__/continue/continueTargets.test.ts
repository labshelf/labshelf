// Verifies that the Continue row picks the newest paper and project file, skips what is gone and survives a failing part.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { PaperRecord } from "@labshelf/core";
import { writeProjectCursor } from "@labshelf/core/node";

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

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-continue-")); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const asStore = (entries = [] as ReturnType<typeof readyEntry>[]): WritingProjects => fakeProjects(entries) as unknown as WritingProjects;

describe("readContinueTargets", () => {
  it("offers nothing without a library or without anything read or edited", async () => {
    expect(await readContinueTargets(undefined, asStore())).toEqual([]);
    expect(await readContinueTargets(library({ loadSidecar: async () => ({ annotations: [] }) }), asStore())).toEqual([]);
  });

  it("offers the paper read last, with its page", async () => {
    expect(await readContinueTargets(library(), asStore())).toEqual([{ kind: "paper", paperId: "recent", title: "Recent paper", page: 6 }]);
  });

  it("offers the project edited last at its saved cursor, when the file still exists", async () => {
    await fs.mkdir(path.join(dir, "sec"));
    await fs.writeFile(path.join(dir, "sec", "a.tex"), "x");
    await writeProjectCursor(dir, { file: "sec/a.tex", line: 4, character: 2, updatedAt: "2026-03-01T00:00:00.000Z" });
    const entries = [readyEntry(dir, { settings: { id: "survey", format: "latex" } as never })];
    const targets = await readContinueTargets(library({ loadSidecar: async () => ({ annotations: [] }) }), asStore(entries));
    expect(targets).toEqual([{ kind: "project", projectId: "survey", file: path.join(dir, "sec", "a.tex"), relativeFile: "sec/a.tex", line: 4, character: 2 }]);

    await fs.rm(path.join(dir, "sec", "a.tex"));
    expect(await readContinueTargets(library({ loadSidecar: async () => ({ annotations: [] }) }), asStore(entries))).toEqual([]);
  });

  it("logs a part that fails and still offers the other", async () => {
    const lib = library({ listPapers: async () => { throw new Error("index"); } });
    await writeProjectCursor(dir, { file: "main.tex", line: 0, character: 0, updatedAt: "2026-03-01T00:00:00.000Z" });
    await fs.writeFile(path.join(dir, "main.tex"), "x");
    const targets = await readContinueTargets(lib, asStore([readyEntry(dir)]));
    expect(targets.map((t) => t.kind)).toEqual(["project"]);
    expect(lib.logger.error).toHaveBeenCalledWith("continue", expect.any(Error), { part: "paper" });
  });
});
