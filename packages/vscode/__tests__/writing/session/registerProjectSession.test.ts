// Tests the Open Project and Close Project commands on the window's project session.
import * as vscode from "vscode";

import { registerProjectSession } from "../../../src/writing/session";
import { commandHandler, fakeHost, fakeProjects, readyEntry } from "../../support/writingFixtures";

const executeCommand = vscode.commands.executeCommand as jest.Mock;
const entry = readyEntry("/code/a");

function setup() {
  const context = { subscriptions: [] as vscode.Disposable[], workspaceState: { get: () => undefined, update: jest.fn(async () => {}) } };
  const projects = { ...fakeProjects([entry]), onDidChange: new vscode.EventEmitter<void>().event };
  const previews = { show: jest.fn(), close: jest.fn() };
  const session = registerProjectSession({ context: context as never, host: fakeHost(), projects, previews });
  return { context, session, previews };
}

beforeEach(() => { jest.clearAllMocks(); });

it("opens the project given to the open command", async () => {
  const { context, session } = setup();
  await commandHandler("labshelf.writing.openProject")(entry);
  expect(executeCommand).toHaveBeenCalledWith("vscode.open", expect.objectContaining({ fsPath: "/code/a/main.tex" }));
  expect(session.project?.folder).toBe("/code/a");
  expect(context.subscriptions).toContain(session);
  session.dispose();
});

it("closes the open project with the close command", async () => {
  const { session, previews } = setup();
  await commandHandler("labshelf.writing.openProject")(entry);
  await commandHandler("labshelf.writing.closeProject")();
  expect(previews.close).toHaveBeenCalledWith("/code/a");
  expect(session.project).toBeUndefined();
  session.dispose();
});
