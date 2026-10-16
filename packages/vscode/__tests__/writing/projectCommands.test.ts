// Tests New project and Add existing folder: happy paths, cancellation and errors shown to the user.
import * as vscode from "vscode";

import { addExistingFolder, createProject, rootFileNames } from "@labshelf/core/node";
import { registerProjectCommands } from "../../src/writing";
import { commandHandler, fakeHost, fakeProjects, readyEntry } from "../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({
  ...jest.requireActual("@labshelf/core/node"),
  createProject: jest.fn(), addExistingFolder: jest.fn(), rootFileNames: jest.fn(),
}));

const window = vscode.window as unknown as Record<string, jest.Mock>;

function setup() {
  const host = fakeHost();
  const projects = fakeProjects();
  registerProjectCommands({ context: { subscriptions: [] } as never, host, projects: projects as never });
  return { host, projects };
}

beforeEach(() => {
  jest.clearAllMocks();
  window["showInputBox"]!.mockResolvedValue(undefined);
  window["showQuickPick"]!.mockResolvedValue(undefined);
  window["showOpenDialog"]!.mockResolvedValue(undefined);
});

describe("labshelf.writing.newProject", () => {
  it("creates the project with the title and format, reloads the list and opens the main file", async () => {
    const { host, projects } = setup();
    window["showInputBox"]!.mockResolvedValue("  Deep nets survey ");
    window["showQuickPick"]!.mockResolvedValue({ label: "Typst", format: "typst" });
    (createProject as jest.Mock).mockResolvedValue(readyEntry("/lib/projects/deep-nets-survey", { main: "main.typ" }));

    await commandHandler("labshelf.writing.newProject")();

    expect(createProject).toHaveBeenCalledWith("/lib", { title: "Deep nets survey", format: "typst" }, host.session.logger);
    expect(projects.reload).toHaveBeenCalled();
    const [command, uri] = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
    expect(command).toBe("vscode.open");
    expect(uri.fsPath).toBe("/lib/projects/deep-nets-survey/main.typ");
  });

  it("creates nothing when the title or the format is cancelled", async () => {
    setup();
    await commandHandler("labshelf.writing.newProject")();
    expect(window["showQuickPick"]).not.toHaveBeenCalled();

    window["showInputBox"]!.mockResolvedValue("Title");
    await commandHandler("labshelf.writing.newProject")();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("does nothing when the library setup is cancelled", async () => {
    const { host } = setup();
    (host.require as jest.Mock).mockResolvedValue(undefined);
    await commandHandler("labshelf.writing.newProject")();
    expect(window["showInputBox"]).not.toHaveBeenCalled();
  });
});

describe("labshelf.writing.addExistingFolder", () => {
  const pick = (path: string) => window["showOpenDialog"]!.mockResolvedValue([vscode.Uri.file(path)]);

  it("registers the folder with the format its sources suggest, without asking", async () => {
    const { host, projects } = setup();
    pick("/code/paper");
    (rootFileNames as jest.Mock).mockResolvedValue(["notes.typ", "refs.bib"]);

    await commandHandler("labshelf.writing.addExistingFolder")();

    expect(window["showQuickPick"]).not.toHaveBeenCalled();
    expect(addExistingFolder).toHaveBeenCalledWith("/lib", { folder: "/code/paper", format: "typst" }, host.session.logger);
    expect(projects.reload).toHaveBeenCalled();
  });

  it("asks for the format only when the folder has no source file", async () => {
    setup();
    pick("/code/empty");
    (rootFileNames as jest.Mock).mockResolvedValue(["README.md"]);
    window["showQuickPick"]!.mockResolvedValue({ label: "LaTeX", format: "latex" });

    await commandHandler("labshelf.writing.addExistingFolder")();

    expect(addExistingFolder).toHaveBeenCalledWith("/lib", { folder: "/code/empty", format: "latex" }, expect.anything());
  });

  it("does not ask for the format when the folder already has labshelf.yaml", async () => {
    setup();
    pick("/code/configured");
    (rootFileNames as jest.Mock).mockResolvedValue(["labshelf.yaml", "README.md"]);

    await commandHandler("labshelf.writing.addExistingFolder")();

    expect(window["showQuickPick"]).not.toHaveBeenCalled();
    expect(addExistingFolder).toHaveBeenCalledWith("/lib", expect.objectContaining({ folder: "/code/configured" }), expect.anything());
  });

  it("registers nothing when the dialog or the format question is cancelled", async () => {
    setup();
    await commandHandler("labshelf.writing.addExistingFolder")();
    pick("/code/empty");
    (rootFileNames as jest.Mock).mockResolvedValue([]);
    await commandHandler("labshelf.writing.addExistingFolder")();
    expect(addExistingFolder).not.toHaveBeenCalled();
  });

  it("shows the error when the folder is inside the library, and logs it", async () => {
    const { host, projects } = setup();
    pick("/lib/projects/x");
    (rootFileNames as jest.Mock).mockResolvedValue(["main.tex"]);
    (addExistingFolder as jest.Mock).mockRejectedValue(new Error("/lib/projects/x is inside the library"));

    await commandHandler("labshelf.writing.addExistingFolder")();

    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("is inside the library"));
    expect(host.session.logger.error).toHaveBeenCalled();
    expect(projects.reload).not.toHaveBeenCalled();
  });
});

describe("labshelf.writing.refresh", () => {
  it("reloads the project list", async () => {
    const { projects } = setup();
    await commandHandler("labshelf.writing.refresh")();
    expect(projects.reload).toHaveBeenCalled();
  });
});
