// Tests that the web build opens the project its workspace folder holds, once, after the library has loaded.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { OPEN_PROJECT_COMMAND } from "../../../src/writing/session";
import { registerWorkspaceProjectOpen } from "../../../src/writing/web/openWorkspaceProject";
import { fakeHost, readyEntry } from "../../support/writingFixtures";

const execute = vscode.commands.executeCommand as jest.Mock;
const workspace = vscode.workspace as unknown as { workspaceFolders: unknown };

function setup(host: { current: () => unknown }) {
  let entries: ProjectEntry[] = [];
  let changed: () => void = () => undefined;
  const projects = { list: () => entries, onDidChange: (listener: () => void) => { changed = listener; return { dispose() {} }; } };
  registerWorkspaceProjectOpen({ context: { subscriptions: [] }, host: host as ReturnType<typeof fakeHost>, projects });
  return { load: (list: ProjectEntry[]) => { entries = list; changed(); } };
}

beforeEach(() => {
  execute.mockReset();
  workspace.workspaceFolders = [{ uri: { fsPath: "/library/projects/cv" } }];
});

describe("registerWorkspaceProjectOpen", () => {
  it("opens the workspace folder's project when the projects load, and only once", () => {
    const { load } = setup(fakeHost());
    const cv = readyEntry("/library/projects/cv");
    load([readyEntry("/library/projects/other"), cv]);
    load([cv]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(OPEN_PROJECT_COMMAND, cv);
  });

  it("waits for an open library", () => {
    let session: unknown;
    const host = fakeHost();
    const { load } = setup({ current: () => session });
    load([readyEntry("/library/projects/cv")]);
    expect(execute).not.toHaveBeenCalled();
    session = host.current();
    load([readyEntry("/library/projects/cv")]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
