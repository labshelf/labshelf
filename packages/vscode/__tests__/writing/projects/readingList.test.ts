// Tests the project reading list and the Add Paper to Reading List command.
import { type PaperRecord } from "@labshelf/core";
import * as vscode from "vscode";
import { ProjectReadingLists, registerReadingListCommands } from "../../../src/writing/projects/readingList";
import { fakeLogger, readyEntry, commandHandler, fakeHost, fakeProjects } from "../../support/writingFixtures";

describe("projectReadingLists", () => {
  const paper = (id: string, citeKey = id): PaperRecord => ({ id, title: `Title ${id}`, path: id, citeKey, status: "unread" }) as PaperRecord;
  const project = readyEntry("/lib/projects/survey", { settings: { id: "survey", format: "latex", papers: [{ key: "c" }] } }) as Parameters<ProjectReadingLists["of"]>[0];
  const backlinks = () => ({
    index: () => new Map([["a", [{ project: "survey", file: "main.tex", line: 0, section: undefined }]], ["z", [{ project: "other", file: "x.tex", line: 0, section: undefined }]]]),
  });

  describe("ProjectReadingLists", () => {
    it("combines cited and added papers and asks about opening only for them", async () => {
      const isOpened = jest.fn(async (id: string) => id === "pc");
      const lists = new ProjectReadingLists({
        backlinks: backlinks(),
        session: () => ({ listPapers: async () => [paper("pa", "a"), paper("pc", "c"), paper("pz", "z")], isOpened, logger: fakeLogger() }),
      });
      const list = await lists.of(project);
      expect(list.entries.map((e) => [e.key, e.cited, e.listed, e.opened])).toEqual([["a", true, false, false], ["c", false, true, true]]);
      expect(list.neverOpened).toBe(1);
      expect(isOpened.mock.calls.map(([id]) => id).sort()).toEqual(["pa", "pc"]);
    });

    it("is empty without an open library", async () => {
      const lists = new ProjectReadingLists({ backlinks: backlinks(), session: () => undefined });
      expect(await lists.of(project)).toEqual({ entries: [], neverOpened: 0 });
    });

    it("logs a failure and returns an empty list", async () => {
      const logger = fakeLogger();
      const lists = new ProjectReadingLists({
        backlinks: backlinks(),
        session: () => ({ listPapers: async () => { throw new Error("index"); }, isOpened: async () => true, logger }),
      });
      expect(await lists.of(project)).toEqual({ entries: [], neverOpened: 0 });
      expect(logger.error).toHaveBeenCalledWith("writing/readingList", expect.any(Error), { action: "build", project: "survey" });
    });
  });
});

describe("readingListCommands", () => {
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
});
