// Tests that Add Paper to Reading List and Remove from Reading List write the papers key of the project's settings.
import * as vscode from "vscode";

import type { PaperRecord } from "@labshelf/core";
import { registerReadingListCommands } from "../../../src/writing/readingList";
import { commandHandler, fakeHost, fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

const window = vscode.window as unknown as Record<string, jest.Mock>;
const paper = (id: string, over: Partial<PaperRecord> = {}): PaperRecord => ({ id, title: `Title ${id}`, path: id, citeKey: id, status: "unread", ...over }) as PaperRecord;

beforeEach(() => jest.clearAllMocks());

type Listed = Array<{ key: string; doi?: string; cited?: true }>;

function setup(listed: Listed | undefined, papers: PaperRecord[], inList: string[] = []) {
  const entry = readyEntry("/code/thesis", { settings: { id: "thesis", format: "latex", ...(listed ? { papers: listed } : {}) } });
  const projects = fakeProjects([entry]);
  const readingLists = { of: jest.fn(async () => ({ entries: inList.map((key) => ({ key, paper: undefined, cited: true, listed: false, opened: false })), neverOpened: 0 })) };
  registerReadingListCommands({ context: { subscriptions: [] } as never, host: fakeHost(fakeLogger()), projects: projects as never, readingLists, listPapers: async () => papers });
  return { projects, entry, update: projects.data.updateProjectSettings };
}

describe("labshelf.writing.addToReadingList", () => {
  it("offers the papers not in the list and appends the chosen one with its DOI", async () => {
    const { projects, entry, update } = setup(undefined, [paper("b", { doi: "10.1/b" }), paper("a"), paper("c")], ["c"]);
    window["showQuickPick"]!.mockImplementation(async (choices: Array<{ label: string }>) => {
      expect(choices.map((choice) => choice.label)).toEqual(["Title a", "Title b"]);
      return choices[1];
    });

    await commandHandler("labshelf.writing.addToReadingList")(entry);

    expect(update).toHaveBeenCalledWith("/code/thesis", { papers: [{ key: "b", doi: "10.1/b" }] });
    expect(projects.reload).toHaveBeenCalled();
  });

  it("keeps earlier entries when a second paper is added", async () => {
    const { entry, update } = setup([{ key: "a" }], [paper("a"), paper("b")], ["a"]);
    window["showQuickPick"]!.mockImplementation(async (choices: unknown[]) => choices[0]);

    await commandHandler("labshelf.writing.addToReadingList")(entry);

    expect(update).toHaveBeenCalledWith("/code/thesis", { papers: [{ key: "a" }, { key: "b" }] });
  });

  it("turns an entry the sync listed as cited into a manual one instead of appending a duplicate", async () => {
    const listed: Listed = [{ key: "a", cited: true }, { key: "b", doi: "10.1/b", cited: true }];
    const { entry, update } = setup(listed, [paper("a", { doi: "10.1/a" }), paper("b"), paper("c")], ["a", "b", "c"]);
    window["showQuickPick"]!.mockImplementation(async (choices: Array<{ label: string }>) => {
      expect(choices.map((choice) => choice.label)).toEqual(["Title a", "Title b"]);
      return choices[0];
    });

    await commandHandler("labshelf.writing.addToReadingList")(entry);

    expect(update).toHaveBeenCalledWith("/code/thesis", { papers: [{ key: "a", doi: "10.1/a" }, { key: "b", doi: "10.1/b", cited: true }] });
  });

  it("writes nothing when the quick pick is dismissed", async () => {
    const { entry, projects, update } = setup(undefined, [paper("a")]);
    window["showQuickPick"]!.mockResolvedValue(undefined);
    await commandHandler("labshelf.writing.addToReadingList")(entry);
    expect(update).not.toHaveBeenCalled();
    expect(projects.reload).not.toHaveBeenCalled();
  });

  it("says so when every paper is already in the list", async () => {
    const { entry } = setup(undefined, [paper("a")], ["a"]);
    await commandHandler("labshelf.writing.addToReadingList")(entry);
    expect(window["showQuickPick"]).not.toHaveBeenCalled();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("already in this reading list"));
  });
});

describe("labshelf.writing.removeFromReadingList", () => {
  const added = (entry: unknown, key: string) => ({ kind: "readingPaper", project: entry, entry: { key, paper: undefined, cited: false, listed: true, opened: false } });

  it("removes the entry", async () => {
    const { entry, update } = setup([{ key: "a" }, { key: "b" }], []);
    await commandHandler("labshelf.writing.removeFromReadingList")(added(entry, "a"));
    expect(update).toHaveBeenCalledWith("/code/thesis", { papers: [{ key: "b" }] });
  });

  it("drops the papers key with the last entry", async () => {
    const { entry, update } = setup([{ key: "b" }], []);
    await commandHandler("labshelf.writing.removeFromReadingList")(added(entry, "b"));
    expect(update).toHaveBeenCalledWith("/code/thesis", { papers: undefined });
  });

  it("does not remove a paper the project cites", async () => {
    const { entry, update } = setup([{ key: "a" }], []);
    const node = added(entry, "a");
    node.entry.cited = true;
    await commandHandler("labshelf.writing.removeFromReadingList")(node);
    expect(update).not.toHaveBeenCalled();
  });
});
