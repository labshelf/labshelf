// Tests how ready, broken, library and external projects appear as Writing view rows.
import * as vscode from "vscode";

import { WritingTreeProvider, projectTreeItem } from "../../src/writing";
import { fakeProjects, readyEntry } from "../support/writingFixtures";

describe("projectTreeItem", () => {
  it("shows a library project by id with its main file, opened on click", () => {
    const entry = readyEntry("/lib/projects/survey");
    const item = projectTreeItem(entry);
    expect(item.label).toBe("survey");
    expect(item.description).toBe("main.tex");
    expect(item.contextValue).toBe("labshelfProject");
    expect(item.tooltip).toBeUndefined();
    expect(item.command).toEqual({ command: "labshelf.writing.openMain", title: "Open Main Document", arguments: [entry] });
  });

  it("marks an external project and gives its folder as tooltip", () => {
    const item = projectTreeItem(readyEntry("/code/paper", { location: "external" }));
    expect(item.contextValue).toBe("labshelfProjectExternal");
    expect(item.tooltip).toBe("/code/paper");
  });

  it("says when a project has no main file", () => {
    expect(projectTreeItem(readyEntry("/lib/projects/x", { main: undefined })).description).toBe("no main file");
  });

  it("shows a broken project with a warning icon and the reason", () => {
    const item = projectTreeItem({ kind: "broken", folder: "/code/gone", location: "external", reason: "folder not found" });
    expect(item.label).toBe("gone");
    expect(item.description).toBe("folder not found");
    expect(item.tooltip).toBe("/code/gone\nfolder not found");
    expect(item.contextValue).toBe("labshelfProjectBrokenExternal");
    expect((item.iconPath as vscode.ThemeIcon).id).toBe("warning");
    expect(item.command).toBeUndefined();
  });

  it("marks a broken library project without the external flag", () => {
    const item = projectTreeItem({ kind: "broken", folder: "/lib/projects/bad", location: "library", reason: "invalid" });
    expect(item.contextValue).toBe("labshelfProjectBroken");
  });
});

describe("WritingTreeProvider", () => {
  it("lists the store's projects as roots and no children below them", () => {
    const entries = [readyEntry("/lib/projects/a"), readyEntry("/code/b", { location: "external" })];
    const provider = new WritingTreeProvider({ ...fakeProjects(entries), onDidChange: new vscode.EventEmitter<void>().event } as never);
    expect(provider.getChildren()).toEqual(entries);
    expect(provider.getChildren(entries[0])).toEqual([]);
  });

  it("refreshes the tree when the store changes", () => {
    const emitter = new vscode.EventEmitter<void>();
    const projects = { ...fakeProjects(), onDidChange: emitter.event };
    const provider = new WritingTreeProvider(projects as never);
    const refreshed = jest.fn();
    provider.onDidChangeTreeData(refreshed);
    emitter.fire();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });
});
