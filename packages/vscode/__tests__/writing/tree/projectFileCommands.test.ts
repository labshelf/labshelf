// Tests the Files view commands: each creates, renames or deletes through workspace.fs at the right URIs and reports failures.
import * as vscode from "vscode";

import { registerProjectFileCommands } from "../../../src/writing/tree";
import { commandHandler, fakeLogger, readyEntry } from "../../support/writingFixtures";
import type { ReadyProject } from "../../../src/writing/figures";

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
