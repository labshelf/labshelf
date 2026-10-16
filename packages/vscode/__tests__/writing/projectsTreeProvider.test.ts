// Tests how ready, broken, library and external projects appear as Writing view rows.
import * as vscode from "vscode";

import { WritingTreeProvider, projectTreeItem } from "../../src/writing";
import type { FigureState } from "@labshelf/core";
import type { FigureNode } from "../../src/writing/figures";
import { fakeProjects, readyEntry } from "../support/writingFixtures";

const NO_FIGURES = { children: async () => [] as FigureNode[], onDidChange: new vscode.EventEmitter<void>().event };

function projectWithFigures(): ReturnType<typeof readyEntry> {
  return readyEntry("/lib/projects/paper", {
    settings: { id: "paper", format: "latex", figures: { "fig/ablation.pdf": { run: "python plot_ablation.py", inputs: ["plot_ablation.py"] } } },
  });
}

function figureNode(state: FigureState): FigureNode {
  const project = projectWithFigures();
  if (project.kind !== "ready") { throw new Error("unreachable"); }
  return { kind: "figure", project, path: "fig/ablation.pdf", recipe: { run: "python plot_ablation.py", inputs: ["plot_ablation.py"] }, state };
}

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

  it("makes a project with figures collapsible and one without not", () => {
    expect(projectTreeItem(projectWithFigures()).collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(projectTreeItem(readyEntry("/lib/projects/x")).collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it("marks a broken library project without the external flag", () => {
    const item = projectTreeItem({ kind: "broken", folder: "/lib/projects/bad", location: "library", reason: "invalid" });
    expect(item.contextValue).toBe("labshelfProjectBroken");
  });
});

describe("WritingTreeProvider", () => {
  it("lists the store's projects as roots and no figures below a project without any", async () => {
    const entries = [readyEntry("/lib/projects/a"), readyEntry("/code/b", { location: "external" })];
    const provider = new WritingTreeProvider({ ...fakeProjects(entries), onDidChange: new vscode.EventEmitter<void>().event } as never, NO_FIGURES);
    expect(provider.getChildren()).toEqual(entries);
    expect(await provider.getChildren(entries[0])).toEqual([]);
  });

  it("refreshes the tree when the store changes", () => {
    const emitter = new vscode.EventEmitter<void>();
    const projects = { ...fakeProjects(), onDidChange: emitter.event };
    const provider = new WritingTreeProvider(projects as never, NO_FIGURES);
    const refreshed = jest.fn();
    provider.onDidChangeTreeData(refreshed);
    emitter.fire();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });
});

describe("figure rows", () => {
  const provider = (children: FigureNode[]): WritingTreeProvider => new WritingTreeProvider(
    { ...fakeProjects(), onDidChange: new vscode.EventEmitter<void>().event } as never,
    { children: async () => children, onDidChange: new vscode.EventEmitter<void>().event },
  );

  it("lists the figures of a ready project below it", async () => {
    const node = figureNode({ status: "fresh", missingInputs: [] });
    expect(await provider([node]).getChildren(node.project)).toEqual([node]);
  });

  it("has no children below a broken project or a figure", async () => {
    const node = figureNode({ status: "fresh", missingInputs: [] });
    const broken = { kind: "broken" as const, folder: "/x", location: "library" as const, reason: "bad" };
    expect(await provider([node]).getChildren(broken)).toEqual([]);
    expect(await provider([node]).getChildren(node)).toEqual([]);
  });

  it("shows a stale figure with the newer inputs and the command, opened on click", () => {
    const item = provider([]).getTreeItem(figureNode({ status: "stale", newerInputs: ["plot_ablation.py"], missingInputs: [] }));
    expect(item.label).toBe("fig/ablation.pdf");
    expect(item.description).toBe("stale");
    expect(item.contextValue).toBe("labshelfFigureStale");
    expect(item.tooltip).toBe("fig/ablation.pdf\nStale: newer inputs\n  plot_ablation.py\nCommand: python plot_ablation.py");
    expect(item.command).toMatchObject({ command: "vscode.open" });
  });

  it("shows a missing figure with the missing marker and nothing to open", () => {
    const item = provider([]).getTreeItem(figureNode({ status: "missing", missingInputs: ["gone.py"] }));
    expect(item.description).toBe("missing");
    expect(item.contextValue).toBe("labshelfFigureStale");
    expect(item.tooltip).toContain("Inputs not found\n  gone.py");
    expect(item.command).toBeUndefined();
  });

  it("shows a fresh figure with no description and its own context value", () => {
    const item = provider([]).getTreeItem(figureNode({ status: "fresh", missingInputs: [] }));
    expect(item.description).toBeUndefined();
    expect(item.contextValue).toBe("labshelfFigure");
  });

  it("refreshes the tree when the figures change", () => {
    const emitter = new vscode.EventEmitter<void>();
    const tree = new WritingTreeProvider({ ...fakeProjects(), onDidChange: new vscode.EventEmitter<void>().event } as never, { children: async () => [], onDidChange: emitter.event });
    const refreshed = jest.fn();
    tree.onDidChangeTreeData(refreshed);
    emitter.fire();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });
});
