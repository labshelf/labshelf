// Tests the commands of a project row: open main, reveal and remove (which never deletes files).
import * as vscode from "vscode";

import { registerProjectItemCommands } from "../../src/writing";
import { commandHandler, fakeHost, fakeProjects, readyEntry } from "../support/writingFixtures";

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

describe("labshelf.writing.openMain", () => {
  it("opens the main file of the project", async () => {
    setup();
    await commandHandler("labshelf.writing.openMain")(readyEntry("/code/paper", { main: "src/main.tex" }));
    expect(executeCommand.mock.calls[0]![0]).toBe("vscode.open");
    expect(executeCommand.mock.calls[0]![1].fsPath).toBe("/code/paper/src/main.tex");
  });

  it("tells the user when the project has no main file", async () => {
    setup();
    await commandHandler("labshelf.writing.openMain")(readyEntry("/code/paper", { main: undefined }));
    expect(executeCommand).not.toHaveBeenCalled();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("no main file"));
  });
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
