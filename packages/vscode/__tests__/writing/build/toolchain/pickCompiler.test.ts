// Tests the compiler pick: it lists the four engines, writes a different choice and ignores the current one and Escape.
import * as vscode from "vscode";

import { updateProjectSettings } from "@labshelf/core/node";
import { registerPickCompiler } from "../../../../src/writing/build/toolchain";
import { commandHandler, fakeHost, fakeProjects, openInEditor, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), updateProjectSettings: jest.fn(async () => {}) }));

const quickPick = vscode.window.showQuickPick as jest.Mock;

function setup(settings: { format: "latex" | "typst"; engine?: "tectonic" | "lualatex" }) {
  const projects = fakeProjects([readyEntry("/code/repo", { settings: { id: "repo", ...settings } })]);
  const host = fakeHost();
  registerPickCompiler({ context: { subscriptions: [] } as never, host, projects });
  return { projects, run: commandHandler("labshelf.writing.pickCompiler") };
}

beforeEach(() => {
  jest.clearAllMocks();
  openInEditor("/code/repo/a.tex");
});

describe("labshelf.writing.pickCompiler", () => {
  it("lists the four engines and marks the current one", async () => {
    quickPick.mockResolvedValueOnce(undefined);
    await setup({ format: "latex", engine: "tectonic" }).run();
    const items = quickPick.mock.calls[0][0];
    expect(items.map((item: { label: string }) => item.label)).toEqual(["XeLaTeX (Tectonic)", "XeLaTeX", "pdfLaTeX", "LuaLaTeX"]);
    expect(items[0]).toMatchObject({ description: "current", detail: "Runs XeLaTeX and downloads on first use." });
    expect(items[1]).toMatchObject({ description: "", detail: "Needs TeX Live (latexmk)." });
  });

  it("writes the picked engine to labshelf.yaml and reloads the projects", async () => {
    quickPick.mockImplementationOnce(async (items) => items.find((item: { engine: string }) => item.engine === "lualatex"));
    const { projects, run } = setup({ format: "latex", engine: "tectonic" });
    await run();
    expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { engine: "lualatex" }, expect.anything());
    expect(projects.reload).toHaveBeenCalled();
  });

  it("writes any pick when the project has no engine yet", async () => {
    quickPick.mockImplementationOnce(async (items) => items[0]);
    await setup({ format: "latex" }).run();
    expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { engine: "tectonic" }, expect.anything());
  });

  it("does nothing when the current engine is picked or the pick is dismissed", async () => {
    const { run } = setup({ format: "latex", engine: "tectonic" });
    quickPick.mockImplementationOnce(async (items) => items[0]);
    await run();
    quickPick.mockResolvedValueOnce(undefined);
    await run();
    expect(updateProjectSettings).not.toHaveBeenCalled();
  });

  it("does nothing outside a LaTeX project", async () => {
    await setup({ format: "typst" }).run();
    expect(quickPick).not.toHaveBeenCalled();
  });
});
