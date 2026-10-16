// Tests Set as Main Document and the status bar's main picker: what they write, and what they refuse.
import * as vscode from "vscode";

import { rootFileNames, updateProjectSettings } from "@labshelf/core/node";
import { registerMainCommands } from "../../src/writing";
import { commandHandler, fakeHost, fakeProjects, readyEntry } from "../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({
  ...jest.requireActual("@labshelf/core/node"), updateProjectSettings: jest.fn(), rootFileNames: jest.fn(),
}));

const window = vscode.window as unknown as Record<string, jest.Mock | unknown>;
const mock = (name: string) => window[name] as jest.Mock;
const file = (p: string) => vscode.Uri.file(p);

function setup(entries = [readyEntry("/code/repo")]) {
  const host = fakeHost();
  const projects = fakeProjects(entries);
  registerMainCommands({ context: { subscriptions: [] } as never, host, projects: projects as never });
  return { host, projects };
}

beforeEach(() => {
  jest.clearAllMocks();
  window["activeTextEditor"] = undefined;
  mock("showQuickPick").mockResolvedValue(undefined);
});

describe("labshelf.writing.setMain", () => {
  it("writes the file's path relative to the project folder and reloads the list", async () => {
    const { host, projects } = setup();
    await commandHandler("labshelf.writing.setMain")(file("/code/repo/src/thesis.tex"));
    expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { main: "src/thesis.tex" }, host.session.logger);
    expect(projects.reload).toHaveBeenCalled();
  });

  it("rejects a file whose extension does not match the project format", async () => {
    setup();
    await commandHandler("labshelf.writing.setMain")(file("/code/repo/main.typ"));
    expect(updateProjectSettings).not.toHaveBeenCalled();
    expect(mock("showErrorMessage")).toHaveBeenCalledWith(expect.stringContaining("does not match the latex format"));
  });

  it("rejects a file that is in no project", async () => {
    setup();
    await commandHandler("labshelf.writing.setMain")(file("/elsewhere/main.tex"));
    expect(updateProjectSettings).not.toHaveBeenCalled();
    expect(mock("showErrorMessage")).toHaveBeenCalledWith("main.tex is not inside a LabShelf project.");
  });

  it("shows a failed write to the user", async () => {
    setup();
    (updateProjectSettings as jest.Mock).mockRejectedValueOnce(new Error("labshelf.yaml: invalid"));
    await commandHandler("labshelf.writing.setMain")(file("/code/repo/main.tex"));
    expect(mock("showErrorMessage")).toHaveBeenCalledWith(expect.stringContaining("labshelf.yaml: invalid"));
  });
});

describe("labshelf.writing.pickMain", () => {
  const activeFile = (p: string) => { window["activeTextEditor"] = { document: { uri: file(p) } }; };

  it("offers the root sources of the active project with the current main marked, and writes the choice", async () => {
    const { host, projects } = setup([readyEntry("/code/repo", { main: "main.tex" })]);
    activeFile("/code/repo/main.tex");
    (rootFileNames as jest.Mock).mockResolvedValue(["intro.tex", "main.tex", "refs.bib"]);
    mock("showQuickPick").mockImplementation(async (items: { label: string }[]) => items[1]);

    await commandHandler("labshelf.writing.pickMain")();

    const items = mock("showQuickPick").mock.calls[0]![0] as { label: string; description: string }[];
    expect(items).toEqual([
      { label: "main.tex", description: "current main" },
      { label: "intro.tex", description: "" },
    ]);
    expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { main: "intro.tex" }, host.session.logger);
    expect(projects.reload).toHaveBeenCalled();
  });

  it("writes nothing when the pick is cancelled or the current main is chosen again", async () => {
    setup([readyEntry("/code/repo", { main: "main.tex" })]);
    activeFile("/code/repo/main.tex");
    (rootFileNames as jest.Mock).mockResolvedValue(["main.tex"]);
    await commandHandler("labshelf.writing.pickMain")();
    mock("showQuickPick").mockImplementation(async (items: unknown[]) => items[0]);
    await commandHandler("labshelf.writing.pickMain")();
    expect(updateProjectSettings).not.toHaveBeenCalled();
  });

  it("explains when the project folder has no source file, and ignores a file outside any project", async () => {
    setup();
    activeFile("/code/repo/notes.md");
    (rootFileNames as jest.Mock).mockResolvedValue(["notes.md"]);
    await commandHandler("labshelf.writing.pickMain")();
    expect(mock("showInformationMessage")).toHaveBeenCalledWith(expect.stringContaining("no latex file"));

    activeFile("/elsewhere/a.tex");
    await commandHandler("labshelf.writing.pickMain")();
    expect(mock("showQuickPick")).not.toHaveBeenCalled();
  });
});
