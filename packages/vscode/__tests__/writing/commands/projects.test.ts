// Tests the project commands: which project owns a file, Set as Main Document and the main picker, the status bar item, adding, refreshing, revealing, removing and copying projects.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import {
  deriveBuildRootPath, findOwningProject, registerAddExistingFolder, registerBuildRootCommands, registerBuildRootStatusBar,
  registerProjectCommands, registerProjectItemCommands,
} from "../../../src/writing/commands/index";
import { commandHandler, fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

describe("owning project", () => {
  describe("findOwningProject", () => {
    const outer = readyEntry("/code/repo");
    const inner = readyEntry("/code/repo/paper");

    it("picks the deepest project folder that contains the file", () => {
      expect(findOwningProject({ list: () => [outer, inner], paths: path }, "/code/repo/paper/sections/intro.tex")).toBe(inner);
      expect(findOwningProject({ list: () => [inner, outer], paths: path }, "/code/repo/paper/main.tex")).toBe(inner);
      expect(findOwningProject({ list: () => [outer, inner], paths: path }, "/code/repo/notes.typ")).toBe(outer);
    });

    it("finds nothing for a file outside every project, in a sibling with the same prefix, or in a broken project", () => {
      expect(findOwningProject({ list: () => [outer], paths: path }, "/code/other/main.tex")).toBeUndefined();
      expect(findOwningProject({ list: () => [outer], paths: path }, "/code/repository/main.tex")).toBeUndefined();
      expect(findOwningProject({ list: () => [{ kind: "broken", folder: "/code/repo", location: "external", reason: "x" }], paths: path }, "/code/repo/main.tex")).toBeUndefined();
      expect(findOwningProject({ list: () => [], paths: path }, "/code/repo/main.tex")).toBeUndefined();
    });
  });

  describe("deriveBuildRootPath", () => {
    it("is relative to the project folder with forward slashes", () => {
      const project = readyEntry(path.join("/code", "repo")) as Parameters<typeof deriveBuildRootPath>[1];
      expect(deriveBuildRootPath(path, project, path.join("/code", "repo", "src", "main.tex"))).toBe("src/main.tex");
      expect(deriveBuildRootPath(path, project, path.join("/code", "repo", "main.tex"))).toBe("main.tex");
    });
  });
});

describe("main document commands", () => {
  const window = vscode.window as unknown as Record<string, jest.Mock | unknown>;
  const mock = (name: string) => window[name] as jest.Mock;
  const file = (p: string) => vscode.Uri.file(p);

  let data: ReturnType<typeof fakeProjects>["data"];

  function setup(entries = [readyEntry("/code/repo")]) {
    const host = fakeHost();
    const projects = fakeProjects(entries);
    data = projects.data;
    registerBuildRootCommands({ context: { subscriptions: [] } as never, host, projects: projects as never });
    return { host, projects };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    window["activeTextEditor"] = undefined;
    mock("showQuickPick").mockResolvedValue(undefined);
  });

  describe("labshelf.writing.setMain", () => {
    it("writes the file's path relative to the project folder and reloads the list", async () => {
      const { projects } = setup();
      await commandHandler("labshelf.writing.setMain")(file("/code/repo/src/thesis.tex"));
      expect(data.updateProjectSettings).toHaveBeenCalledWith("/code/repo", { main: "src/thesis.tex" });
      expect(projects.reload).toHaveBeenCalled();
    });

    it("rejects a file whose extension does not match the project format", async () => {
      setup();
      await commandHandler("labshelf.writing.setMain")(file("/code/repo/main.typ"));
      expect(data.updateProjectSettings).not.toHaveBeenCalled();
      expect(mock("showErrorMessage")).toHaveBeenCalledWith(expect.stringContaining("does not match the latex format"));
    });

    it("rejects a file that is in no project", async () => {
      setup();
      await commandHandler("labshelf.writing.setMain")(file("/elsewhere/main.tex"));
      expect(data.updateProjectSettings).not.toHaveBeenCalled();
      expect(mock("showErrorMessage")).toHaveBeenCalledWith("main.tex is not inside a LabShelf project.");
    });

    it("shows a failed write to the user", async () => {
      setup();
      data.updateProjectSettings.mockRejectedValueOnce(new Error("labshelf.yaml: invalid"));
      await commandHandler("labshelf.writing.setMain")(file("/code/repo/main.tex"));
      expect(mock("showErrorMessage")).toHaveBeenCalledWith(expect.stringContaining("labshelf.yaml: invalid"));
    });
  });

  describe("labshelf.writing.pickMain", () => {
    const activeFile = (p: string) => { window["activeTextEditor"] = { document: { uri: file(p) } }; };

    it("offers the root sources of the active project with the current main marked, and writes the choice", async () => {
      const { projects } = setup([readyEntry("/code/repo", { main: "main.tex" })]);
      activeFile("/code/repo/main.tex");
      data.rootFileNames.mockResolvedValue(["intro.tex", "main.tex", "refs.bib"]);
      mock("showQuickPick").mockImplementation(async (items: { label: string }[]) => items[1]);

      await commandHandler("labshelf.writing.pickMain")();

      const items = mock("showQuickPick").mock.calls[0]![0] as { label: string; description: string }[];
      expect(items).toEqual([
        { label: "main.tex", description: "current main" },
        { label: "intro.tex", description: "" },
      ]);
      expect(data.updateProjectSettings).toHaveBeenCalledWith("/code/repo", { main: "intro.tex" });
      expect(projects.reload).toHaveBeenCalled();
    });

    it("writes nothing when the pick is cancelled or the current main is chosen again", async () => {
      setup([readyEntry("/code/repo", { main: "main.tex" })]);
      activeFile("/code/repo/main.tex");
      data.rootFileNames.mockResolvedValue(["main.tex"]);
      await commandHandler("labshelf.writing.pickMain")();
      mock("showQuickPick").mockImplementation(async (items: unknown[]) => items[0]);
      await commandHandler("labshelf.writing.pickMain")();
      expect(data.updateProjectSettings).not.toHaveBeenCalled();
    });

    it("explains when the project folder has no source file, and ignores a file outside any project", async () => {
      setup();
      activeFile("/code/repo/notes.md");
      data.rootFileNames.mockResolvedValue(["notes.md"]);
      await commandHandler("labshelf.writing.pickMain")();
      expect(mock("showInformationMessage")).toHaveBeenCalledWith(expect.stringContaining("no latex file"));

      activeFile("/elsewhere/a.tex");
      await commandHandler("labshelf.writing.pickMain")();
      expect(mock("showQuickPick")).not.toHaveBeenCalled();
    });
  });
});

describe("main document status bar", () => {
  const window = vscode.window as unknown as { activeTextEditor: unknown; _fireActiveEditorChange: () => void };

  function setup(entries: ProjectEntry[]) {
    const changes = new vscode.EventEmitter<void>();
    let current = entries;
    registerBuildRootStatusBar({ subscriptions: [] } as never, { list: () => current, paths: path, onDidChange: changes.event });
    const item = (vscode.window.createStatusBarItem as jest.Mock).mock.results[0]!.value;
    return { item, setProjects: (next: ProjectEntry[]) => { current = next; changes.fire(); } };
  }

  const editing = (scheme: string, fsPath: string) => {
    window.activeTextEditor = { document: { uri: Object.assign(vscode.Uri.file(fsPath), { scheme }) } };
    window._fireActiveEditorChange();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    window.activeTextEditor = undefined;
  });

  describe("registerBuildRootStatusBar", () => {
    it("opens the main picker on click and starts hidden when no editor is active", () => {
      const { item } = setup([readyEntry("/code/repo")]);
      expect(item.command).toBe("labshelf.writing.pickMain");
      expect(item.show).not.toHaveBeenCalled();
      expect(item.hide).toHaveBeenCalled();
    });

    it("shows the main file of the project that owns the active file", () => {
      const { item } = setup([readyEntry("/code/repo", { main: "main.tex" })]);
      editing("file", "/code/repo/sections/intro.tex");
      expect(item.text).toBe("$(file) main.tex");
      expect(item.show).toHaveBeenCalled();
    });

    it("uses the deepest project when projects are nested", () => {
      const { item } = setup([readyEntry("/code/repo", { main: "outer.tex" }), readyEntry("/code/repo/paper", { main: "inner.tex" })]);
      editing("file", "/code/repo/paper/a.tex");
      expect(item.text).toBe("$(file) inner.tex");
    });

    it("says when the project has no main file", () => {
      const { item } = setup([readyEntry("/code/repo", { main: undefined })]);
      editing("file", "/code/repo/a.tex");
      expect(item.text).toBe("$(file) no main file");
    });

    it("hides for a file in no project and for non-file documents", () => {
      const { item } = setup([readyEntry("/code/repo")]);
      editing("file", "/code/repo/a.tex");
      item.hide.mockClear();
      editing("file", "/elsewhere/a.tex");
      expect(item.hide).toHaveBeenCalledTimes(1);
      editing("untitled", "/code/repo/a.tex");
      expect(item.hide).toHaveBeenCalledTimes(2);
    });

    it("follows the project list when it reloads", () => {
      const { item, setProjects } = setup([readyEntry("/code/repo", { main: "a.tex" })]);
      editing("file", "/code/repo/x.tex");
      setProjects([readyEntry("/code/repo", { main: "b.tex" })]);
      expect(item.text).toBe("$(file) b.tex");
      setProjects([]);
      expect(item.hide).toHaveBeenCalled();
    });
  });
});

describe("add and refresh commands", () => {
  const window = vscode.window as unknown as Record<string, jest.Mock>;

  let data: ReturnType<typeof fakeProjects>["data"];

  function setup() {
    const host = fakeHost();
    const projects = fakeProjects();
    data = projects.data;
    registerProjectCommands({ context: { subscriptions: [] } as never, host, projects: projects as never });
    registerAddExistingFolder({ context: { subscriptions: [] } as never, host, projects: projects as never });
    return { host, projects };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    window["showInputBox"]!.mockResolvedValue(undefined);
    window["showQuickPick"]!.mockResolvedValue(undefined);
    window["showOpenDialog"]!.mockResolvedValue(undefined);
  });

  describe("labshelf.writing.newBlankProject", () => {
    it("creates the project from the blank template of the picked format, reloads the list and opens the project", async () => {
      const { projects } = setup();
      window["showInputBox"]!.mockResolvedValue("  Deep nets survey ");
      window["showQuickPick"]!.mockResolvedValue({ label: "Typst", format: "typst" });
      const entry = readyEntry("/lib/projects/deep-nets-survey", { main: "main.typ" });
      data.createProjectFromTemplate.mockResolvedValue(entry);

      await commandHandler("labshelf.writing.newBlankProject")();

      expect(data.createProjectFromTemplate).toHaveBeenCalledWith("/lib", expect.objectContaining({
        title: "Deep nets survey",
        template: { id: "blank-typst", format: "typst", main: "main.typ" },
        files: [expect.objectContaining({ path: "main.typ" })],
      }));
      expect(projects.reload).toHaveBeenCalled();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("labshelf.writing.openProject", entry);
    });

    it("creates nothing when the title or the format is cancelled", async () => {
      setup();
      await commandHandler("labshelf.writing.newBlankProject")();
      expect(window["showQuickPick"]).not.toHaveBeenCalled();

      window["showInputBox"]!.mockResolvedValue("Title");
      await commandHandler("labshelf.writing.newBlankProject")();
      expect(data.createProjectFromTemplate).not.toHaveBeenCalled();
    });

    it("does nothing when the library setup is cancelled", async () => {
      const { host } = setup();
      (host.require as jest.Mock).mockResolvedValue(undefined);
      await commandHandler("labshelf.writing.newBlankProject")();
      expect(window["showInputBox"]).not.toHaveBeenCalled();
    });
  });

  describe("labshelf.writing.addExistingFolder", () => {
    const pick = (path: string) => window["showOpenDialog"]!.mockResolvedValue([vscode.Uri.file(path)]);

    it("registers the folder with the format its sources suggest, without asking", async () => {
      const { projects } = setup();
      pick("/code/paper");
      data.rootFileNames.mockResolvedValue(["notes.typ", "refs.bib"]);
      data.addExistingFolder.mockResolvedValue(readyEntry("/code/paper"));

      await commandHandler("labshelf.writing.addExistingFolder")();

      expect(window["showQuickPick"]).not.toHaveBeenCalled();
      expect(data.addExistingFolder).toHaveBeenCalledWith("/lib", { folder: "/code/paper", format: "typst" });
      expect(projects.reload).toHaveBeenCalled();
    });

    it("asks for the format only when the folder has no source file", async () => {
      setup();
      pick("/code/empty");
      data.rootFileNames.mockResolvedValue(["README.md"]);
      window["showQuickPick"]!.mockResolvedValue({ label: "LaTeX", format: "latex" });

      await commandHandler("labshelf.writing.addExistingFolder")();

      expect(data.addExistingFolder).toHaveBeenCalledWith("/lib", { folder: "/code/empty", format: "latex" });
    });

    it("does not ask for the format when the folder already has labshelf.yaml", async () => {
      setup();
      pick("/code/configured");
      data.rootFileNames.mockResolvedValue(["labshelf.yaml", "README.md"]);

      await commandHandler("labshelf.writing.addExistingFolder")();

      expect(window["showQuickPick"]).not.toHaveBeenCalled();
      expect(data.addExistingFolder).toHaveBeenCalledWith("/lib", expect.objectContaining({ folder: "/code/configured" }));
    });

    it("registers nothing when the dialog or the format question is cancelled", async () => {
      setup();
      await commandHandler("labshelf.writing.addExistingFolder")();
      pick("/code/empty");
      data.rootFileNames.mockResolvedValue([]);
      await commandHandler("labshelf.writing.addExistingFolder")();
      expect(data.addExistingFolder).not.toHaveBeenCalled();
    });

    it("shows the error when the folder is inside the library, and logs it", async () => {
      const { host, projects } = setup();
      pick("/lib/projects/x");
      data.rootFileNames.mockResolvedValue(["main.tex"]);
      data.addExistingFolder.mockRejectedValue(new Error("/lib/projects/x is inside the library"));

      await commandHandler("labshelf.writing.addExistingFolder")();

      expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("is inside the library"));
      expect(host.session.logger.error).toHaveBeenCalled();
      expect(projects.reload).not.toHaveBeenCalled();
    });
  });

  describe("labshelf.writing.refresh", () => {
    it("reloads the project list", async () => {
      const { projects } = setup();
      await commandHandler("labshelf.writing.refresh")();
      expect(projects.reload).toHaveBeenCalled();
    });
  });
});

describe("project entry commands", () => {
  const window = vscode.window as unknown as Record<string, jest.Mock>;
  const executeCommand = vscode.commands.executeCommand as jest.Mock;

  let unregisterProjectFolder: jest.Mock;

  function setup() {
    const host = fakeHost();
    const projects = fakeProjects();
    unregisterProjectFolder = projects.data.unregisterProjectFolder;
    registerProjectItemCommands({ context: { subscriptions: [] } as never, host, projects: projects as never });
    return { host, projects };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    window["showWarningMessage"]!.mockResolvedValue(undefined);
  });

  describe("labshelf.writing.reveal", () => {
    it("reveals the project folder in the OS file manager", async () => {
      setup();
      await commandHandler("labshelf.writing.reveal")(readyEntry("/code/paper"));
      expect(executeCommand.mock.calls[0]![0]).toBe("revealFileInOS");
      expect(executeCommand.mock.calls[0]![1].fsPath).toBe("/code/paper");
    });
  });

  describe("labshelf.writing.removeProject", () => {
    const external = readyEntry("/code/paper", { location: "external" });

    it("asks for confirmation saying files stay, then only unregisters the folder", async () => {
      const { projects } = setup();
      window["showWarningMessage"]!.mockResolvedValue("Remove from LabShelf");

      await commandHandler("labshelf.writing.removeProject")(external);

      const [, options] = window["showWarningMessage"]!.mock.calls[0]!;
      expect(options).toEqual({ modal: true, detail: "The files in /code/paper are not deleted." });
      expect(unregisterProjectFolder).toHaveBeenCalledWith("/lib", "/code/paper");
      expect(projects.reload).toHaveBeenCalled();
    });

    it("keeps the project when the confirmation is dismissed", async () => {
      setup();
      await commandHandler("labshelf.writing.removeProject")(external);
      expect(unregisterProjectFolder).not.toHaveBeenCalled();
    });

    it("refuses to remove a project that lives in the library", async () => {
      setup();
      window["showWarningMessage"]!.mockResolvedValue("Remove from LabShelf");
      await commandHandler("labshelf.writing.removeProject")(readyEntry("/lib/projects/a"));
      expect(window["showWarningMessage"]).not.toHaveBeenCalled();
      expect(unregisterProjectFolder).not.toHaveBeenCalled();
    });

    it("removes a broken external project too", async () => {
      setup();
      window["showWarningMessage"]!.mockResolvedValue("Remove from LabShelf");
      await commandHandler("labshelf.writing.removeProject")({ kind: "broken", folder: "/gone", location: "external", reason: "folder not found" });
      expect(unregisterProjectFolder).toHaveBeenCalledWith("/lib", "/gone");
    });
  });
});
