// Tests the Figures view: a figure row's Arc mark and tooltip for each status, the open project's figures, the count in the view description and the hasFigures context key.
import * as vscode from "vscode";
import * as path from "node:path";

import type { FigureNode, ReadyProject } from "../../../src/writing/projects/index";
import { ProjectFiguresView } from "../../../src/writing/projects/index";
import { createFigureTreeItem } from "../../../src/writing/projects/figuresView";
import { readyEntry } from "../../support/writingFixtures";

describe("Figure rows", () => {
  const arcIcon = (tone: string, progress: string) => ({
    light: vscode.Uri.file(`/marks/${tone}-${progress}-light.svg`),
    dark: vscode.Uri.file(`/marks/${tone}-${progress}-dark.svg`),
  });

  function node(state: FigureNode["state"]): FigureNode {
    const project = readyEntry("/code/paper") as ReadyProject;
    return { kind: "figure", project, path: "fig/a.pdf", recipe: { run: "python plot.py", inputs: [] }, state };
  }

  describe("createFigureTreeItem", () => {
    it.each([
      [{ status: "stale", newerInputs: ["plot.py"], missingInputs: [] }, "warn", "Stale"],
      [{ status: "missing", missingInputs: [] }, "err", "Missing"],
      [{ status: "fresh", missingInputs: [] }, "ok", "Fresh"],
    ] as const)("marks a %o figure with a full %s arc and names the status in the tooltip", (state, tone, label) => {
      const item = createFigureTreeItem(node(state as FigureNode["state"]), path, arcIcon);
      expect(item.iconPath).toEqual(arcIcon(tone, "full"));
      expect(item.tooltip).toContain(label);
    });
  });
});

describe("Figures view", () => {
  const executeCommand = vscode.commands.executeCommand as jest.Mock;
  const arcIcon = () => ({ light: vscode.Uri.file("/light.svg"), dark: vscode.Uri.file("/dark.svg") });
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function node(project: ReadyProject, figurePath: string): FigureNode {
    return { kind: "figure", project, path: figurePath, recipe: { run: "python plot.py", inputs: [] }, state: { status: "fresh", missingInputs: [] } };
  }

  function setup(open: boolean, figurePaths: string[] = []) {
    const project = readyEntry("/code/paper") as ReadyProject;
    const sessionChanged = new vscode.EventEmitter<ReadyProject | undefined>();
    const figuresChanged = new vscode.EventEmitter<void>();
    const session = { project: open ? project : undefined, onDidChange: sessionChanged.event };
    const figures = { children: jest.fn(async (target: ReadyProject) => figurePaths.map((p) => node(target, p))), onDidChange: figuresChanged.event };
    const view = new ProjectFiguresView({ session, figures, paths: path, arcIcon });
    const treeView: { description?: string } = {};
    view.attach(treeView as vscode.TreeView<FigureNode>);
    return { view, treeView, session, figures, sessionChanged, figuresChanged, project };
  }

  const hasFiguresKey = (): unknown => executeCommand.mock.calls.filter(([cmd, key]) => cmd === "setContext" && key === "labshelf.writing.hasFigures").at(-1)?.[2];

  beforeEach(() => jest.clearAllMocks());

  describe("ProjectFiguresView", () => {
    it("has no children, an empty description and a false key when no project is open", async () => {
      const { view, treeView, figures } = setup(false);
      await flush();
      expect(view.getChildren()).toEqual([]);
      expect(figures.children).not.toHaveBeenCalled();
      expect(treeView.description).toBe("");
      expect(hasFiguresKey()).toBe(false);
    });

    it("has an empty description and a false key when the open project has no figures", async () => {
      const { view, treeView } = setup(true);
      await flush();
      expect(view.getChildren()).toEqual([]);
      expect(treeView.description).toBe("");
      expect(hasFiguresKey()).toBe(false);
    });

    it("lists the open project's figures with their count as description and a true key", async () => {
      const { view, treeView, project } = setup(true, ["fig/a.pdf", "fig/b.pdf"]);
      await flush();
      expect(view.getChildren()).toEqual([node(project, "fig/a.pdf"), node(project, "fig/b.pdf")]);
      expect(treeView.description).toBe("2");
      expect(hasFiguresKey()).toBe(true);
    });

    it("renders a figure row with the figure item and has no children below a figure", async () => {
      const { view, project } = setup(true, ["fig/a.pdf"]);
      await flush();
      const item = view.getTreeItem(node(project, "fig/a.pdf"));
      expect(item.label).toBe("fig/a.pdf");
      expect(item.contextValue).toBe("labshelfFigure");
      expect(view.getChildren(node(project, "fig/a.pdf"))).toEqual([]);
    });

    it("reloads and refreshes the tree when the session changes", async () => {
      const { view, treeView, session, figures, sessionChanged } = setup(false);
      await flush();
      const refreshed = jest.fn();
      view.onDidChangeTreeData(refreshed);
      figures.children.mockImplementation(async (target) => [node(target, "fig/a.pdf")]);
      (session as { project: ReadyProject | undefined }).project = readyEntry("/code/paper") as ReadyProject;
      sessionChanged.fire(session.project);
      await flush();
      expect(treeView.description).toBe("1");
      expect(hasFiguresKey()).toBe(true);
      expect(refreshed).toHaveBeenCalledTimes(1);
    });

    it("reloads when the figures change", async () => {
      const { treeView, figures, figuresChanged } = setup(true, ["fig/a.pdf"]);
      await flush();
      figures.children.mockResolvedValueOnce([]);
      figuresChanged.fire();
      await flush();
      expect(treeView.description).toBe("");
      expect(hasFiguresKey()).toBe(false);
    });
  });
});
