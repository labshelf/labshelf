// Tests the VS Code IO of the reader's cite popup: reading an open document's unsaved text, inserting through a workspace edit, the recent files and the bibliography refresh.
import * as vscode from "vscode";
import { createReaderCite, createReaderCiteIo } from "../../src/reader/citeInProject";
import { fakeProjects, readyEntry } from "../support/writingFixtures";
import { paper } from "../support/citationFixtures";

const cited = paper({ id: "p1", citeKey: "smith2020", doi: "10.1/x", title: "A paper" });

function setup() {
  const project = readyEntry("/code/thesis", { main: "main.tex", settings: { id: "thesis", format: "latex" } });
  const projects = fakeProjects([project]);
  projects.data.listProjectFiles.mockResolvedValue(["main.tex", "intro.tex", "refs.bib", "chapters/two.tex"]);
  const readText = jest.fn(async () => "on disk");
  projects.fs.readText = readText;
  const view = { uri: vscode.Uri.file("/code/thesis/intro.tex"), line: () => 1, reveal: () => {} };
  const deps = { projects, activeSource: { current: () => view as typeof view | undefined, listOpen: () => [] as typeof view[] } };
  return { project: project as Parameters<ReturnType<typeof createReaderCiteIo>["read"]>[0], projects, readText, view, deps };
}

function openDoc(fsPath: string, text: string) {
  const document = {
    uri: vscode.Uri.file(fsPath), getText: () => text, save: jest.fn(async () => true),
    positionAt: (offset: number) => new vscode.Position(0, offset),
  };
  (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [document];
  return document;
}

describe("the reader cite IO of VS Code", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [];
  });

  it("reads an open document's unsaved text, else the file on disk", async () => {
    const { deps, project, readText } = setup();
    const io = createReaderCiteIo(deps);
    openDoc("/code/thesis/intro.tex", "unsaved");
    expect(await io.read(project, "intro.tex")).toBe("unsaved");
    expect(readText).not.toHaveBeenCalled();
    expect(await io.read(project, "main.tex")).toBe("on disk");
    expect(readText).toHaveBeenCalledWith("/code/thesis/main.tex");
  });

  it("inserts with a workspace edit at the offset and leaves an open document unsaved", async () => {
    const { deps, project } = setup();
    const document = openDoc("/code/thesis/intro.tex", "abcdef");
    await createReaderCiteIo(deps).insert(project, "intro.tex", 3, "\\cite{a}");
    const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0][0] as vscode.WorkspaceEdit & { replacements: { uri: vscode.Uri; range: vscode.Range; text: string }[] };
    expect(edit.replacements).toHaveLength(1);
    const [replacement] = edit.replacements;
    expect(replacement?.uri.fsPath).toBe("/code/thesis/intro.tex");
    expect(replacement?.range.start).toEqual(new vscode.Position(0, 3));
    expect(replacement?.range.end).toEqual(new vscode.Position(0, 3));
    expect(replacement?.text).toBe("\\cite{a}");
    expect(document.save).not.toHaveBeenCalled();
  });

  it("saves a file that was not open before the edit", async () => {
    const { deps, project } = setup();
    const document = { uri: vscode.Uri.file("/code/thesis/main.tex"), getText: () => "x", save: jest.fn(async () => true), positionAt: (offset: number) => new vscode.Position(0, offset) };
    (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValueOnce(document);
    await createReaderCiteIo(deps).insert(project, "main.tex", 1, "\\cite{a}");
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(document.save).toHaveBeenCalledTimes(1);
  });

  it("fails when the edit is refused", async () => {
    const { deps, project } = setup();
    openDoc("/code/thesis/intro.tex", "abc");
    (vscode.workspace.applyEdit as jest.Mock).mockResolvedValueOnce(false);
    await expect(createReaderCiteIo(deps).insert(project, "intro.tex", 0, "x")).rejects.toThrow("Could not write");
  });

  it("refreshes the bibliography with the source's uri", async () => {
    const { deps, project } = setup();
    await createReaderCiteIo(deps).refreshBibliography(project, "chapters/two.tex");
    const call = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
    expect(call[0]).toBe("labshelf.citations.updateBibliography");
    expect((call[1] as vscode.Uri).fsPath).toBe("/code/thesis/chapters/two.tex");
  });

  it("puts the current source first among the recent files, then open editors, as project-relative paths", () => {
    const { deps, project, view } = setup();
    const other = { ...view, uri: vscode.Uri.file("/code/thesis/chapters/two.tex") };
    const outside = { ...view, uri: vscode.Uri.file("/code/elsewhere/x.tex") };
    deps.activeSource.listOpen = () => [other, outside];
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [{ document: { uri: vscode.Uri.file("/code/thesis/main.tex") } }, { document: { uri: view.uri } }];
    expect(createReaderCiteIo(deps).recentFiles(project)).toEqual(["intro.tex", "chapters/two.tex", "main.tex"]);
  });

  it("answers the popup's requests through answerReaderCite: the current source first in the files", async () => {
    const { deps } = setup();
    const reply = await createReaderCite(deps)(cited, { kind: "targets" });
    expect(reply).toMatchObject({ kind: "targets", projects: [{ id: "thesis", files: ["intro.tex", "main.tex", "chapters/two.tex"] }] });
  });

  it("adds the paper to the project's papers, reloads and updates labshelf.bib", async () => {
    const { deps, projects } = setup();
    const reply = await createReaderCite(deps)(cited, { kind: "bibliography", projectId: "thesis" });
    expect(reply).toEqual({ kind: "listed", bibliography: "labshelf.bib" });
    expect(projects.data.updateProjectSettings).toHaveBeenCalledWith("/code/thesis", { papers: [{ key: "smith2020", doi: "10.1/x" }] });
    expect(projects.reload).toHaveBeenCalled();
  });

  it("uses no QuickPick", async () => {
    const { deps } = setup();
    await createReaderCite(deps)(cited, { kind: "targets" });
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });
});
