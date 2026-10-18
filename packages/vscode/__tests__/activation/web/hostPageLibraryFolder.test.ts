// Tests that the web build takes its library folder from the editor page's host command, and only when the page has one.
import * as vscode from "vscode";

import { hostPageLibraryFolder, LIBRARY_FOLDER_COMMAND } from "../../../src/activation/web/hostPageLibraryFolder";

const execute = vscode.commands.executeCommand as jest.Mock;
const getCommands = vscode.commands.getCommands as jest.Mock;
const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

beforeEach(() => { execute.mockReset(); getCommands.mockReset(); logger.error.mockClear(); });

describe("hostPageLibraryFolder", () => {
  it("returns the page's folder as a file: URI", async () => {
    getCommands.mockResolvedValue([LIBRARY_FOLDER_COMMAND]);
    execute.mockResolvedValueOnce("/library");
    const folder = await hostPageLibraryFolder(logger);
    expect(execute).toHaveBeenCalledWith(LIBRARY_FOLDER_COMMAND);
    expect(folder?.scheme).toBe("file");
    expect(folder?.path).toBe("/library");
  });

  it("returns undefined without calling it when no page registered the command", async () => {
    getCommands.mockResolvedValue(["workbench.action.files.save"]);
    expect(await hostPageLibraryFolder(logger)).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("logs and returns undefined when the page answers something that is not an absolute path", async () => {
    getCommands.mockResolvedValue([LIBRARY_FOLDER_COMMAND]);
    execute.mockResolvedValueOnce(42);
    expect(await hostPageLibraryFolder(logger)).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("logs and returns undefined when the page command fails", async () => {
    getCommands.mockResolvedValue([LIBRARY_FOLDER_COMMAND]);
    execute.mockRejectedValueOnce(new Error("bridge down"));
    expect(await hostPageLibraryFolder(logger)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("activation", expect.any(Error), { action: "ask the editor page for its library folder" });
  });
});
