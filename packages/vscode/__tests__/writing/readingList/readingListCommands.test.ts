// Tests that Add Paper to Reading List and Remove from Reading List write the papers key of the project's labshelf.yaml.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import type { PaperRecord } from "@labshelf/core";
import { parseProjectFile } from "@labshelf/core";
import { readProject } from "@labshelf/core/node";
import { registerReadingListCommands } from "../../../src/writing/readingList";
import { commandHandler, fakeHost, fakeLogger } from "../../support/writingFixtures";

const window = vscode.window as unknown as Record<string, jest.Mock>;
const paper = (id: string, over: Partial<PaperRecord> = {}): PaperRecord => ({ id, title: `Title ${id}`, path: id, citeKey: id, status: "unread", ...over }) as PaperRecord;

let folder: string;

beforeEach(async () => {
  jest.clearAllMocks();
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "reading-list-"));
});
afterEach(() => fs.rm(folder, { recursive: true, force: true }));

async function setup(yaml: string, papers: PaperRecord[], inList: string[] = []) {
  await fs.writeFile(path.join(folder, "labshelf.yaml"), yaml);
  const logger = fakeLogger();
  const host = fakeHost(logger);
  const read = () => readProject(folder, "library", logger);
  let entry = await read();
  const projects = { list: () => [entry], reload: jest.fn(async () => { entry = await read(); }) };
  const readingLists = { of: jest.fn(async () => ({ entries: inList.map((key) => ({ key, paper: undefined, cited: true, listed: false, opened: false })), neverOpened: 0 })) };
  registerReadingListCommands({ context: { subscriptions: [] } as never, host, projects: projects as never, readingLists, listPapers: async () => papers });
  return { projects, entry: () => entry };
}

const yamlText = () => fs.readFile(path.join(folder, "labshelf.yaml"), "utf8");

describe("labshelf.writing.addToReadingList", () => {
  it("offers the papers not in the list and appends the chosen one with its DOI, keeping comments", async () => {
    const { projects, entry } = await setup("# mine\nid: thesis\nformat: latex\n", [paper("b", { doi: "10.1/b" }), paper("a"), paper("c")], ["c"]);
    window["showQuickPick"]!.mockImplementation(async (choices: Array<{ label: string }>) => {
      expect(choices.map((choice) => choice.label)).toEqual(["Title a", "Title b"]);
      return choices[1];
    });

    await commandHandler("labshelf.writing.addToReadingList")(entry());

    const text = await yamlText();
    expect(text).toContain("# mine");
    const parsed = parseProjectFile(text);
    expect(parsed.ok && parsed.settings.papers).toEqual([{ key: "b", doi: "10.1/b" }]);
    expect(projects.reload).toHaveBeenCalled();
  });

  it("keeps earlier entries when a second paper is added", async () => {
    const { entry } = await setup("id: thesis\nformat: latex\npapers:\n  - key: a\n", [paper("a"), paper("b")], ["a"]);
    window["showQuickPick"]!.mockImplementation(async (choices: unknown[]) => choices[0]);

    await commandHandler("labshelf.writing.addToReadingList")(entry());

    const parsed = parseProjectFile(await yamlText());
    expect(parsed.ok && parsed.settings.papers).toEqual([{ key: "a" }, { key: "b" }]);
  });

  it("writes nothing when the quick pick is dismissed", async () => {
    const { entry, projects } = await setup("id: thesis\nformat: latex\n", [paper("a")]);
    window["showQuickPick"]!.mockResolvedValue(undefined);
    await commandHandler("labshelf.writing.addToReadingList")(entry());
    expect(await yamlText()).toBe("id: thesis\nformat: latex\n");
    expect(projects.reload).not.toHaveBeenCalled();
  });

  it("says so when every paper is already in the list", async () => {
    const { entry } = await setup("id: thesis\nformat: latex\n", [paper("a")], ["a"]);
    await commandHandler("labshelf.writing.addToReadingList")(entry());
    expect(window["showQuickPick"]).not.toHaveBeenCalled();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("already in this reading list"));
  });
});

describe("labshelf.writing.removeFromReadingList", () => {
  const added = (entry: unknown, key: string) => ({ kind: "readingPaper", project: entry, entry: { key, paper: undefined, cited: false, listed: true, opened: false } });

  it("removes the entry and drops the key with the last one", async () => {
    const { entry } = await setup("id: thesis\nformat: latex\npapers:\n  - key: a\n  - key: b\n", []);
    await commandHandler("labshelf.writing.removeFromReadingList")(added(entry(), "a"));
    const first = parseProjectFile(await yamlText());
    expect(first.ok && first.settings.papers).toEqual([{ key: "b" }]);

    await commandHandler("labshelf.writing.removeFromReadingList")(added(entry(), "b"));
    expect(await yamlText()).not.toContain("papers");
  });

  it("does not remove a paper the project cites", async () => {
    const { entry } = await setup("id: thesis\nformat: latex\npapers:\n  - key: a\n", []);
    const node = added(entry(), "a");
    node.entry.cited = true;
    await commandHandler("labshelf.writing.removeFromReadingList")(node);
    expect(await yamlText()).toContain("key: a");
  });
});
