// Tests the Writing view rows of a project's reading list: the list row, the never-opened warning and the paper rows.
import * as vscode from "vscode";

import type { PaperRecord, ReadingListEntry } from "@labshelf/core";
import { WritingTreeProvider } from "../../../src/writing";
import { readingListChildren, readingTreeItem, type ReadingListNode } from "../../../src/writing/readingList";
import { fakeProjects, readyEntry } from "../../support/writingFixtures";

const project = readyEntry("/lib/projects/survey") as ReadingListNode["project"];
const paper = (id: string, over: Partial<PaperRecord> = {}): PaperRecord => ({ id, title: `Title ${id}`, path: id, citeKey: id, status: "unread", ...over }) as PaperRecord;
const entry = (key: string, over: Partial<ReadingListEntry> = {}): ReadingListEntry => ({ key, paper: paper(key), cited: true, listed: false, opened: true, ...over });

function listNode(entries: ReadingListEntry[], neverOpened = 0): ReadingListNode {
  return { kind: "readingList", project, list: { entries, neverOpened } };
}

describe("reading list row", () => {
  it("counts the papers and expands when there are some", () => {
    const item = readingTreeItem(listNode([entry("a"), entry("b")]));
    expect(item.label).toBe("Reading list");
    expect(item.description).toBe("2");
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(item.contextValue).toBe("labshelfReadingList");
    expect(readingTreeItem(listNode([])).collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });
});

describe("reading list children", () => {
  it("puts the warning first, singular for one paper and plural for more", () => {
    const [one] = readingListChildren(listNode([entry("a")], 1));
    expect(readingTreeItem(one!).label).toBe("You cite 1 paper you never opened");
    const [many] = readingListChildren(listNode([entry("a"), entry("b")], 4));
    expect(readingTreeItem(many!).label).toBe("You cite 4 papers you never opened");
    expect((readingTreeItem(many!).iconPath as vscode.ThemeIcon).id).toBe("warning");
  });

  it("has no warning when every cited paper was opened", () => {
    expect(readingListChildren(listNode([entry("a")])).map((node) => node.kind)).toEqual(["readingPaper"]);
  });
});

describe("paper rows", () => {
  it("shows title, status and origin, with the status icon, opened in the reader on click", () => {
    const item = readingTreeItem({ kind: "readingPaper", project, entry: entry("a", { paper: paper("a", { status: "reading" }) }) });
    expect(item.label).toBe("Title a");
    expect(item.description).toBe("Reading · cited");
    expect((item.iconPath as vscode.ThemeIcon).id).toBe("play-circle");
    expect(item.command).toEqual({ command: "labshelf.openPdfViewer", title: "Open Paper", arguments: ["a"] });
    expect(item.contextValue).toBe("labshelfReadingPaper");
  });

  it("marks a paper the user added, which can be removed", () => {
    const item = readingTreeItem({ kind: "readingPaper", project, entry: entry("b", { cited: false, listed: true, paper: paper("b", { status: "done" }) }) });
    expect(item.description).toBe("Done · added");
    expect(item.contextValue).toBe("labshelfReadingPaperAdded");
  });

  it("shows a key with no library paper by the key and opens nothing", () => {
    const item = readingTreeItem({ kind: "readingPaper", project, entry: entry("ghost", { paper: undefined, opened: false }) });
    expect(item.label).toBe("ghost");
    expect(item.description).toBe("Not in the library · cited");
    expect(item.command).toBeUndefined();
  });
});

describe("WritingTreeProvider reading list", () => {
  it("lists the reading list of a ready project and its rows, and refreshes when the list changes", async () => {
    const list = { entries: [entry("a")], neverOpened: 1 };
    const changed = new vscode.EventEmitter<void>();
    const provider = new WritingTreeProvider(
      { ...fakeProjects(), onDidChange: new vscode.EventEmitter<void>().event } as never,
      { children: async () => [], onDidChange: new vscode.EventEmitter<void>().event },
      { of: async () => list, onDidChange: changed.event },
    );
    const [node] = await provider.getChildren(project);
    expect(node).toEqual({ kind: "readingList", project, list });
    expect((await provider.getChildren(node)).map((child) => child.kind)).toEqual(["readingWarning", "readingPaper"]);
    const refreshed = jest.fn();
    provider.onDidChangeTreeData(refreshed);
    changed.fire();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });
});
