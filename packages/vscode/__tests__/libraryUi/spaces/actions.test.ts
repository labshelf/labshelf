// Prevents Space name prompts from mutating a library that has been switched away.
import * as vscode from "vscode";
import { handleSidebarSpaceMessage } from "../../../src/libraryUi/spaces/index.js";

it("leaves the prior Space unchanged after a root switch during rename", async () => {
  const renameSpace = jest.fn();
  const binding = { store: { read: async () => ({ state: "ready", space: { name: "Research" } }), renameSpace },
    logger: { error: jest.fn() } };
  let current: typeof binding | undefined = binding;
  (vscode.window.showInputBox as jest.Mock).mockImplementationOnce(async () => { current = undefined; return "Work"; });
  await handleSidebarSpaceMessage({ type: "spaceAction", action: "renameSpace", id: "research" }, { current: () => current } as never);
  expect(renameSpace).not.toHaveBeenCalled();
  expect(binding.logger.error).toHaveBeenCalled();
  expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("library changed"));
});
