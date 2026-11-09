// Tests the Import a .bib file command: the papers written into a new library folder, the entries the library already holds, the link to the project and the closing message.
import * as path from "node:path";
import * as vscode from "vscode";
import { registerImportBibliographyCommand } from "../../../src/writing/citations/importBibliography";
import { fakeLogger, fakeProjects, readyEntry, commandHandler } from "../../support/writingFixtures";
import { paper } from "../../support/citationFixtures";

const BIB = `@article{new1, title={One}, year={2020}}
@article{held, title={Two}}
@article{new2, title={Three}, doi={10.1000/three}}`;

function setup(existingFolders: string[] = []) {
  const updateProjectSettings = jest.fn(async () => {});
  const updateProject = jest.fn(async () => {});
  const projects = { ...fakeProjects([readyEntry("/code/repo", { settings: { id: "repo", format: "latex", libraryFolders: ["old"] } })]), data: { updateProjectSettings } };
  const writeArtifacts = jest.fn(async (..._args: unknown[]) => {});
  const ctx = {
    papersRoot: "/lib/papers", logger: fakeLogger(), paths: { join: (...p: string[]) => p.join("/"), basename: path.basename },
    fs: { exists: async (p: string) => existingFolders.some((f) => p === `/lib/papers/${f}`), writeFile: jest.fn(async () => {}) },
    artifacts: { writePaperArtifacts: writeArtifacts },
  };
  const reindex = jest.fn(async () => {});
  const host = { current: () => ({ root: "/lib", logger: fakeLogger() }), require: async () => ({ root: "/lib", logger: fakeLogger() }) };
  registerImportBibliographyCommand({
    context: { subscriptions: [] } as unknown as vscode.ExtensionContext, host, projects: projects as never, activeSource: { current: () => undefined },
    listPapers: async () => [paper({ id: "held", citeKey: "held", path: "papers/old/held" })], sync: { updateProject },
    library: () => ({ ctx: ctx as never, takenIds: () => ["held"], reindex }),
  });
  return { updateProjectSettings, writeArtifacts, reindex };
}

describe("labshelf.writing.importBibliography", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([vscode.Uri.file("/home/me/refs.bib")]);
    (vscode.workspace.fs.readFile as jest.Mock) = jest.fn(async () => new TextEncoder().encode(BIB));
  });

  it("writes the entries the library lacks into a folder named after the file, links it and reports", async () => {
    const { updateProjectSettings, writeArtifacts, reindex } = setup();
    (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: unknown[]) => items[0]);
    await commandHandler("labshelf.writing.importBibliography")(undefined);
    expect(writeArtifacts.mock.calls.map((c) => c[0])).toEqual(["/lib/papers/refs/new1", "/lib/papers/refs/new2"]);
    expect(reindex).toHaveBeenCalled();
    expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { libraryFolders: ["old", "refs"] });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Imported 2 references into refs (1 already in your library).");
  });

  it("numbers the folder when its name is taken", async () => {
    const { updateProjectSettings } = setup(["refs"]);
    (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: unknown[]) => items[0]);
    await commandHandler("labshelf.writing.importBibliography")(undefined);
    expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { libraryFolders: ["old", "refs 2"] });
  });

  it("writes nothing and links nothing when the dialog is cancelled", async () => {
    const { updateProjectSettings, writeArtifacts } = setup();
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: unknown[]) => items[0]);
    await commandHandler("labshelf.writing.importBibliography")(undefined);
    expect(writeArtifacts).not.toHaveBeenCalled();
    expect(updateProjectSettings).not.toHaveBeenCalled();
  });
});
