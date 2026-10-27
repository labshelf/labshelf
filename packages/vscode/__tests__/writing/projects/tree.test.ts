// Tests the tree module of writing projects, one describe per concern:
// - the Files view: the open project's folder from disk, hidden folders, folder-first order and the main file mark.
// - that the Files view follows outside changes to the open project's folder with one debounced watcher per project.
// - the Files view commands: each creates, renames or deletes through workspace.fs at the right URIs and reports failures.
import * as vscode from "vscode";

import { ProjectFilesProvider, type ProjectFileNode, watchProjectFiles, registerProjectFileCommands } from "../../../src/writing/projects/tree";
import type { ReadyProject } from "../../../src/writing/figures";
import { fakeLogger, readyEntry, commandHandler } from "../../support/writingFixtures";

describe("projectFilesProvider", () => {
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
});

describe("projectFilesWatcher", () => {
  interface MockWatcher { pattern: { base: vscode.Uri; pattern: string }; dispose: jest.Mock; _fire: (kind: string, uri: vscode.Uri) => void }
  const watchers = (): MockWatcher[] => (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.map((r) => r.value);
  const a = readyEntry("/code/a") as ReadyProject;
  const b = readyEntry("/code/b") as ReadyProject;

  function setup(project: ReadyProject | undefined) {
    const changed = new vscode.EventEmitter<ReadyProject | undefined>();
    const refresh = jest.fn();
    const watcher = watchProjectFiles({ project, onDidChange: changed.event }, refresh);
    return { changed, refresh, watcher };
  }

  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
  afterEach(() => jest.useRealTimers());

  describe("watchProjectFiles", () => {
    it("watches the open project's folder and refreshes once per burst of changes", () => {
      const { refresh } = setup(a);
      expect(watchers()).toHaveLength(1);
      expect(watchers()[0]!.pattern.base.fsPath).toBe("/code/a");
      expect(watchers()[0]!.pattern.pattern).toBe("**");
      watchers()[0]!._fire("create", vscode.Uri.file("/code/a/x.tex"));
      watchers()[0]!._fire("delete", vscode.Uri.file("/code/a/y.tex"));
      expect(refresh).not.toHaveBeenCalled();
      jest.advanceTimersByTime(200);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("replaces the watcher when another project opens and drops it on close", () => {
      const { changed } = setup(a);
      changed.fire(b);
      expect(watchers()[0]!.dispose).toHaveBeenCalled();
      expect(watchers()[1]!.pattern.base.fsPath).toBe("/code/b");
      changed.fire(undefined);
      expect(watchers()[1]!.dispose).toHaveBeenCalled();
      expect(watchers()).toHaveLength(2);
    });

    it("watches nothing while no project is open and stops a pending refresh on dispose", () => {
      const { changed, refresh, watcher } = setup(undefined);
      expect(watchers()).toHaveLength(0);
      changed.fire(a);
      watchers()[0]!._fire("create", vscode.Uri.file("/code/a/x.tex"));
      watcher.dispose();
      jest.advanceTimersByTime(200);
      expect(refresh).not.toHaveBeenCalled();
      expect(watchers()[0]!.dispose).toHaveBeenCalled();
    });
  });
});

describe("projectFileCommands", () => {
  const fs = vscode.workspace.fs as unknown as Record<"writeFile" | "createDirectory" | "rename" | "delete" | "stat", jest.Mock>;
  const window = vscode.window as unknown as Record<"showInputBox" | "showWarningMessage" | "showErrorMessage", jest.Mock>;
  const executeCommand = vscode.commands.executeCommand as jest.Mock;
  const { File, Directory } = vscode.FileType;

  function setup(project: ReadyProject | null = readyEntry("/code/paper") as ReadyProject) {
    const logger = fakeLogger();
    registerProjectFileCommands({ context: { subscriptions: [] } as never, session: { project: project ?? undefined }, logger, fs: { writeFile: async (file, bytes) => { await vscode.workspace.fs.writeFile(vscode.Uri.file(file), bytes); } } });
    return { logger };
  }

  const folder = { uri: vscode.Uri.file("/code/paper/src"), type: Directory };
  const file = { uri: vscode.Uri.file("/code/paper/src/intro.tex"), type: File };
  const fsPaths = (mock: jest.Mock, index = 0): string[] => mock.mock.calls.map((call) => call[index].fsPath);

  beforeEach(() => {
    jest.clearAllMocks();
    fs.stat.mockRejectedValue(new Error("ENOENT"));
  });

  describe("new file and folder", () => {
    it("creates an empty file at the project root and opens it", async () => {
      setup();
      window.showInputBox.mockResolvedValueOnce("notes.tex");
      await commandHandler("labshelf.writing.newFile")();
      expect(fsPaths(fs.writeFile)).toEqual(["/code/paper/notes.tex"]);
      expect(fs.writeFile.mock.calls[0]![1]).toEqual(new Uint8Array());
      expect(executeCommand).toHaveBeenCalledWith("vscode.open", fs.writeFile.mock.calls[0]![0]);
    });

    it("creates a folder inside the folder it is called on", async () => {
      setup();
      window.showInputBox.mockResolvedValueOnce("chapters");
      await commandHandler("labshelf.writing.newFolder")(folder);
      expect(fsPaths(fs.createDirectory)).toEqual(["/code/paper/src/chapters"]);
    });

    it("does not overwrite a file that exists", async () => {
      const { logger } = setup();
      fs.stat.mockResolvedValueOnce({ type: File });
      window.showInputBox.mockResolvedValueOnce("main.tex");
      await commandHandler("labshelf.writing.newFile")();
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("main.tex"));
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("rejects empty names, path separators and dot names", async () => {
      setup();
      await commandHandler("labshelf.writing.newFile")();
      const validate = window.showInputBox.mock.calls[0]![0].validateInput as (value: string) => string | undefined;
      for (const bad of ["", "  ", "a/b", "a\\b", ".", ".."]) { expect(validate(bad)).toEqual(expect.any(String)); }
      expect(validate("notes.tex")).toBeUndefined();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("does nothing while no project is open", async () => {
      setup(null);
      await commandHandler("labshelf.writing.newFolder")();
      expect(window.showInputBox).not.toHaveBeenCalled();
    });
  });

  describe("rename", () => {
    it("renames inside the same folder without overwriting", async () => {
      setup();
      window.showInputBox.mockResolvedValueOnce("introduction.tex");
      await commandHandler("labshelf.writing.renameFile")(file);
      expect(window.showInputBox.mock.calls[0]![0].value).toBe("intro.tex");
      expect(fsPaths(fs.rename)).toEqual(["/code/paper/src/intro.tex"]);
      expect(fsPaths(fs.rename, 1)).toEqual(["/code/paper/src/introduction.tex"]);
      expect(fs.rename.mock.calls[0]![2]).toEqual({ overwrite: false });
    });

    it("logs a failure with the URI and shows an error", async () => {
      const { logger } = setup();
      fs.rename.mockRejectedValueOnce(new Error("EEXIST"));
      window.showInputBox.mockResolvedValueOnce("main.tex");
      await commandHandler("labshelf.writing.renameFile")(file);
      expect(logger.error).toHaveBeenCalledWith("writing/tree", expect.any(Error), expect.objectContaining({ action: "rename", uri: "/code/paper/src/intro.tex" }));
      expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("EEXIST"));
    });
  });

  describe("delete", () => {
    it("moves the item to the trash after a modal confirmation", async () => {
      setup();
      window.showWarningMessage.mockResolvedValueOnce("Delete");
      await commandHandler("labshelf.writing.deleteFile")(folder);
      expect(window.showWarningMessage.mock.calls[0]![1]).toEqual(expect.objectContaining({ modal: true }));
      expect(window.showWarningMessage.mock.calls[0]![2]).toBe("Delete");
      expect(fsPaths(fs.delete)).toEqual(["/code/paper/src"]);
      expect(fs.delete.mock.calls[0]![1]).toEqual({ recursive: true, useTrash: true });
    });

    it("does nothing when the confirmation is dismissed", async () => {
      setup();
      await commandHandler("labshelf.writing.deleteFile")(file);
      expect(fs.delete).not.toHaveBeenCalled();
    });
  });
});
