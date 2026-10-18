// Tests the build on open: the LaTeX project open as a workspace folder builds its main file once, while auto compile is on.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { registerLatexOpenBuild } from "../../../../src/writing/build/triggers/latexOpenBuild";
import { fakeHost, readyEntry } from "../../../support/writingFixtures";

const workspace = vscode.workspace as unknown as {
  workspaceFolders: { uri: vscode.Uri }[] | undefined;
  _config: Record<string, Record<string, unknown>>;
};

let context: { subscriptions: { dispose(): void }[] };

function setup(entries: ProjectEntry[]) {
  let list = entries;
  const listeners: (() => void)[] = [];
  const projects = {
    list: () => list,
    onDidChange: (listener: () => void) => { listeners.push(listener); return { dispose: () => undefined }; },
  };
  const request = jest.fn(async () => undefined);
  context = { subscriptions: [] };
  const host = fakeHost();
  return {
    request, host,
    register: () => registerLatexOpenBuild({ context, host, projects, request }),
    load: (next: ProjectEntry[]) => { list = next; listeners.forEach((listener) => listener()); },
  };
}

beforeEach(() => {
  delete workspace._config["labshelf.writing"];
  workspace.workspaceFolders = [{ uri: vscode.Uri.file("/library/projects/paper") }];
});

afterEach(() => {
  context.subscriptions.forEach((subscription) => subscription.dispose());
  workspace.workspaceFolders = undefined;
});

describe("registerLatexOpenBuild", () => {
  it("builds the open project's main file once the projects load, and only once", async () => {
    const { request, register, load } = setup([]);
    register();
    expect(request).not.toHaveBeenCalled();
    load([readyEntry("/library/projects/paper"), readyEntry("/library/projects/other")]);
    load([readyEntry("/library/projects/paper")]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/library/projects/paper", "main.tex");
  });

  it("builds at once when the projects are already loaded", () => {
    const { request, register } = setup([readyEntry("/library/projects/paper")]);
    register();
    expect(request).toHaveBeenCalledWith("/library/projects/paper", "main.tex");
  });

  it("does not build Typst projects, projects without a main file or projects that are not open", () => {
    const { request, register, load } = setup([]);
    register();
    load([readyEntry("/library/projects/paper", { main: "main.typ", settings: { id: "paper", format: "typst" } })]);
    load([readyEntry("/library/projects/paper", { main: undefined })]);
    load([readyEntry("/library/projects/other")]);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not build while auto compile is off, and logs why", () => {
    workspace._config["labshelf.writing"] = { autoCompile: false };
    const { request, register, host } = setup([readyEntry("/library/projects/paper")]);
    register();
    expect(request).not.toHaveBeenCalled();
    expect(host.session.logger.log).toHaveBeenCalledTimes(1);
  });
});
