// Tests the compiler pick: it lists the three engines, writes a different choice and ignores the current one and Escape.
import * as vscode from "vscode";

import { registerPickCompiler } from "../../../../src/writing/build/toolchain";
import { commandHandler, fakeHost, fakeProjects, openInEditor, readyEntry } from "../../../support/writingFixtures";

const quickPick = vscode.window.showQuickPick as jest.Mock;

function setup(settings: { format: "latex" | "typst"; engine?: "pdflatex" | "lualatex" }) {
  const projects = fakeProjects([readyEntry("/code/repo", { settings: { id: "repo", ...settings } })]);
  const host = fakeHost();
  registerPickCompiler({ context: { subscriptions: [] } as never, host, projects });
  return { projects, update: projects.data.updateProjectSettings, run: commandHandler("labshelf.writing.pickCompiler") };
}

beforeEach(() => {
  jest.clearAllMocks();
  openInEditor("/code/repo/a.tex");
});

describe("labshelf.writing.pickCompiler", () => {
  it("lists the three engines and marks the current one", async () => {
    quickPick.mockResolvedValueOnce(undefined);
    await setup({ format: "latex", engine: "pdflatex" }).run();
    const items = quickPick.mock.calls[0][0];
    expect(items.map((item: { label: string }) => item.label)).toEqual(["pdfLaTeX", "XeLaTeX", "LuaLaTeX"]);
    expect(items[0]).toMatchObject({ description: "current" });
    expect(items[1]).toMatchObject({ description: "" });
  });

  it("writes the picked engine to labshelf.yaml and reloads the projects", async () => {
    quickPick.mockImplementationOnce(async (items) => items.find((item: { engine: string }) => item.engine === "lualatex"));
    const { projects, update, run } = setup({ format: "latex", engine: "pdflatex" });
    await run();
    expect(update).toHaveBeenCalledWith("/code/repo", { engine: "lualatex" });
    expect(projects.reload).toHaveBeenCalled();
  });

  it("writes any pick when the project has no engine yet", async () => {
    quickPick.mockImplementationOnce(async (items) => items[0]);
    const { update, run } = setup({ format: "latex" });
    await run();
    expect(update).toHaveBeenCalledWith("/code/repo", { engine: "pdflatex" });
  });

  it("does nothing when the current engine is picked or the pick is dismissed", async () => {
    const { update, run } = setup({ format: "latex", engine: "pdflatex" });
    quickPick.mockImplementationOnce(async (items) => items[0]);
    await run();
    quickPick.mockResolvedValueOnce(undefined);
    await run();
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing outside a LaTeX project", async () => {
    await setup({ format: "typst" }).run();
    expect(quickPick).not.toHaveBeenCalled();
  });
});
