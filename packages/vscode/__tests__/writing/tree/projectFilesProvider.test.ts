// Tests the Files view: the open project's folder from disk, hidden folders, folder-first order and the main file mark.
import * as vscode from "vscode";

import { ProjectFilesProvider, type ProjectFileNode } from "../../../src/writing/tree";
import { fakeLogger, readyEntry } from "../../support/writingFixtures";
import type { ReadyProject } from "../../../src/writing/figures";

const readDirectory = vscode.workspace.fs.readDirectory as jest.Mock;
const { File, Directory } = vscode.FileType;

function setup(project: ReadyProject | null = readyEntry("/code/paper", { main: "src/main.tex" }) as ReadyProject) {
  const sessionChanged = new vscode.EventEmitter<ReadyProject | undefined>();
  const projectsChanged = new vscode.EventEmitter<void>();
  const session = { project: project ?? undefined, onDidChange: sessionChanged.event };
  const logger = fakeLogger();
  const provider = new ProjectFilesProvider({ session, projects: { onDidChange: projectsChanged.event }, logger });
  return { provider, session, sessionChanged, projectsChanged, logger };
}

const names = (nodes: ProjectFileNode[]): string[] => nodes.map((node) => node.uri.fsPath);

beforeEach(() => jest.clearAllMocks());

describe("ProjectFilesProvider", () => {
  it("lists the project folder with folders first, sorted by name, without .git and .labshelf", async () => {
    readDirectory.mockResolvedValueOnce([
      ["refs.bib", File], [".labshelf", Directory], ["src", Directory], ["Abstract.tex", File], [".git", Directory], ["figures", Directory],
    ]);
    const { provider } = setup();
    const children = await provider.getChildren();
    expect(readDirectory.mock.calls[0]![0].fsPath).toBe("/code/paper");
    expect(names(children)).toEqual(["/code/paper/figures", "/code/paper/src", "/code/paper/Abstract.tex", "/code/paper/refs.bib"]);
  });

  it("lists a folder's children when it is expanded", async () => {
    readDirectory.mockResolvedValueOnce([["main.tex", File]]);
    const { provider } = setup();
    const children = await provider.getChildren({ uri: vscode.Uri.file("/code/paper/src"), type: Directory });
    expect(readDirectory.mock.calls[0]![0].fsPath).toBe("/code/paper/src");
    expect(names(children)).toEqual(["/code/paper/src/main.tex"]);
  });

  it("is empty when no project is open", async () => {
    const { provider } = setup(null);
    expect(await provider.getChildren()).toEqual([]);
    expect(readDirectory).not.toHaveBeenCalled();
  });

  it("logs a folder it cannot read and shows it empty", async () => {
    readDirectory.mockRejectedValueOnce(new Error("ENOENT"));
    const { provider, logger } = setup();
    expect(await provider.getChildren()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith("writing/tree", expect.any(Error), expect.objectContaining({ uri: "/code/paper" }));
  });

  it("opens a file on click and marks the main file", () => {
    const { provider } = setup();
    const main = provider.getTreeItem({ uri: vscode.Uri.file("/code/paper/src/main.tex"), type: File });
    expect(main.resourceUri?.fsPath).toBe("/code/paper/src/main.tex");
    expect(main.description).toBe("main");
    expect(main.contextValue).toBe("labshelfProjectFile");
    expect(main.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    expect(main.command).toEqual({ command: "vscode.open", title: "Open File", arguments: [main.resourceUri] });
    expect(provider.getTreeItem({ uri: vscode.Uri.file("/code/paper/refs.bib"), type: File }).description).toBeUndefined();
  });

  it("shows a folder collapsed without a command", () => {
    const { provider } = setup();
    const folder = provider.getTreeItem({ uri: vscode.Uri.file("/code/paper/src"), type: Directory });
    expect(folder.contextValue).toBe("labshelfProjectFolder");
    expect(folder.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(folder.command).toBeUndefined();
  });

  it("refreshes when the session or the project list changes", () => {
    const { provider, sessionChanged, projectsChanged } = setup();
    const listener = jest.fn();
    provider.onDidChangeTreeData(listener);
    sessionChanged.fire(undefined);
    projectsChanged.fire();
    provider.refresh();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
