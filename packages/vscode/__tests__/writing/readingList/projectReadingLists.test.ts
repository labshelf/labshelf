// Tests that a project's reading list joins its backlinks, its papers: entries and the library, reading the sidecar only for listed papers.
import type { PaperRecord } from "@labshelf/core";
import { ProjectReadingLists } from "../../../src/writing/readingList";
import { fakeLogger, readyEntry } from "../../support/writingFixtures";

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
