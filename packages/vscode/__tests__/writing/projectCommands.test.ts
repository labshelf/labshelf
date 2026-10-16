// Tests New project and Add existing folder: happy paths, cancellation and errors shown to the user.
import * as vscode from "vscode";

import { registerProjectCommands } from "../../src/writing";
import { commandHandler, fakeHost, fakeProjects, readyEntry } from "../support/writingFixtures";

const window = vscode.window as unknown as Record<string, jest.Mock>;

let data: ReturnType<typeof fakeProjects>["data"];

function setup() {
  const host = fakeHost();
  const projects = fakeProjects();
  data = projects.data;
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
    const { projects } = setup();
    window["showInputBox"]!.mockResolvedValue("  Deep nets survey ");
    window["showQuickPick"]!.mockResolvedValue({ label: "Typst", format: "typst" });
    data.createProject.mockResolvedValue(readyEntry("/lib/projects/deep-nets-survey", { main: "main.typ" }));

    await commandHandler("labshelf.writing.newProject")();

    expect(data.createProject).toHaveBeenCalledWith("/lib", { title: "Deep nets survey", format: "typst" });
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
    expect(data.createProject).not.toHaveBeenCalled();
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
    const { projects } = setup();
    pick("/code/paper");
    data.rootFileNames.mockResolvedValue(["notes.typ", "refs.bib"]);
    data.addExistingFolder.mockResolvedValue(readyEntry("/code/paper"));

    await commandHandler("labshelf.writing.addExistingFolder")();

    expect(window["showQuickPick"]).not.toHaveBeenCalled();
    expect(data.addExistingFolder).toHaveBeenCalledWith("/lib", { folder: "/code/paper", format: "typst" });
    expect(projects.reload).toHaveBeenCalled();
  });

  it("asks for the format only when the folder has no source file", async () => {
    setup();
    pick("/code/empty");
    data.rootFileNames.mockResolvedValue(["README.md"]);
    window["showQuickPick"]!.mockResolvedValue({ label: "LaTeX", format: "latex" });

    await commandHandler("labshelf.writing.addExistingFolder")();

    expect(data.addExistingFolder).toHaveBeenCalledWith("/lib", { folder: "/code/empty", format: "latex" });
  });

  it("does not ask for the format when the folder already has labshelf.yaml", async () => {
    setup();
    pick("/code/configured");
    data.rootFileNames.mockResolvedValue(["labshelf.yaml", "README.md"]);

    await commandHandler("labshelf.writing.addExistingFolder")();

    expect(window["showQuickPick"]).not.toHaveBeenCalled();
    expect(data.addExistingFolder).toHaveBeenCalledWith("/lib", expect.objectContaining({ folder: "/code/configured" }));
  });

  it("registers nothing when the dialog or the format question is cancelled", async () => {
    setup();
    await commandHandler("labshelf.writing.addExistingFolder")();
    pick("/code/empty");
    data.rootFileNames.mockResolvedValue([]);
    await commandHandler("labshelf.writing.addExistingFolder")();
    expect(data.addExistingFolder).not.toHaveBeenCalled();
  });

  it("shows the error when the folder is inside the library, and logs it", async () => {
    const { host, projects } = setup();
    pick("/lib/projects/x");
    data.rootFileNames.mockResolvedValue(["main.tex"]);
    data.addExistingFolder.mockRejectedValue(new Error("/lib/projects/x is inside the library"));

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
