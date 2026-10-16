// Tests that accepting a citation or saving a source regenerates labshelf.bib, and what the user is told when that cannot finish.
import * as vscode from "vscode";

import { registerCitationProviders } from "../../../src/writing/citations";
import { citationWorkspace, PAPERS } from "../../support/citationFixtures";
import { commandHandler } from "../../support/writingFixtures";
import { fakeDocument } from "../../support/textDocument";

let update: jest.Mock;
const warning = vscode.window.showWarningMessage as jest.Mock;
const result = (mainLine: string, papersWritten = false) => ({ written: true, papersWritten, missing: [], mainLine });

function setup() {
  const workspace = citationWorkspace("latex");
  workspace.projects = { ...workspace.projects, reload: jest.fn(async () => {}) };
  update = workspace.projects.data.updateProjectBibliography as jest.Mock;
  update.mockResolvedValue(result("not-needed"));
  registerCitationProviders({ subscriptions: [] } as never, workspace);
  return workspace as typeof workspace & { projects: { reload: jest.Mock } };
}
const accept = (file = "/code/repo/a.tex") => commandHandler("labshelf.citations.updateBibliography")(vscode.Uri.file(file));
const savedHandler = () => (vscode.workspace.onDidSaveTextDocument as jest.Mock).mock.calls[0]![0] as (d: vscode.TextDocument) => void;

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
});

describe("bibliography update on accept", () => {
  it("regenerates the bibliography of the owning project with the library papers and the open editors", async () => {
    setup();
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [fakeDocument("/code/repo/main.tex", "open text")];
    await accept();
    const [project, papers, open] = update.mock.calls[0]!;
    expect(project).toMatchObject({ folder: "/code/repo", main: "main.tex", settings: { format: "latex" } });
    expect(papers).toEqual(PAPERS);
    expect(open.text("/code/repo/main.tex")).toBe("open text");
    expect(open.text("/code/repo/other.tex")).toBeUndefined();
  });

  it("replaces the whole text of an open document without saving, and reports a closed one", async () => {
    setup();
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [fakeDocument("/code/repo/main.tex", "ab\ncd")];
    await accept();
    const open = update.mock.calls[0]![2];
    expect(await open.replace("/code/repo/main.tex", "new")).toBe(true);
    const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0]![0];
    expect(edit.replacements[0]).toMatchObject({ text: "new", range: { start: { line: 0, character: 0 }, end: { line: 1, character: 2 } } });
    expect(await open.replace("/code/repo/closed.tex", "x")).toBe(false);
  });

  it("does nothing for a file outside a ready project", async () => {
    setup();
    await accept("/elsewhere/a.tex");
    expect(update).not.toHaveBeenCalled();
  });

  it("reloads the project list when the first citation added the bibliography", async () => {
    const workspace = setup();
    update.mockResolvedValue(result("added"));
    await accept();
    expect(workspace.projects.reload).toHaveBeenCalledTimes(1);
  });
});

describe("papers list of labshelf.yaml", () => {
  it("reloads the project list when the papers list was written, and not when nothing changed", async () => {
    const workspace = setup();
    await accept();
    expect(workspace.projects.reload).not.toHaveBeenCalled();
    update.mockResolvedValue(result("not-needed", true));
    await accept();
    expect(workspace.projects.reload).toHaveBeenCalledTimes(1);
  });
});

describe("bibliography update on save", () => {
  it("runs for a project source and not for other files", async () => {
    setup();
    savedHandler()(fakeDocument("/code/repo/chapter.tex", ""));
    savedHandler()(fakeDocument("/code/repo/notes.md", ""));
    savedHandler()(fakeDocument("/code/repo/chapter.typ", ""));
    await new Promise((resolve) => setImmediate(resolve));
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("bibliography problems", () => {
  it("warns once per project when the main file loads another bibliography", async () => {
    setup();
    update.mockResolvedValue(result("conflict"));
    await accept();
    await accept();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]![0]).toContain('already loads another bibliography. Add "labshelf.bib" to it');
  });

  it("does not warn about keys the library lacks", async () => {
    setup();
    update.mockResolvedValue({ written: true, missing: ["fig1"], mainLine: "present" });
    await accept();
    expect(warning).not.toHaveBeenCalled();
  });

  it("logs a failure with the project folder and shows it", async () => {
    const workspace = setup();
    const failure = new Error("disk full");
    update.mockRejectedValue(failure);
    await accept();
    expect(workspace.logger.error).toHaveBeenCalledWith("writing/citations", failure, { folder: "/code/repo", action: "update-bibliography" });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });
});

describe("provider registration", () => {
  it("registers completion, hover and links for .tex and .typ files with their trigger characters", () => {
    setup();
    const completion = (vscode.languages.registerCompletionItemProvider as jest.Mock).mock.calls;
    expect(completion.map(([selector, , ...triggers]) => [selector.pattern, triggers])).toEqual([
      ["**/*.tex", ["{", ",", "["]], ["**/*.typ", ["@", "<", "["]],
    ]);
    expect(vscode.languages.registerHoverProvider).toHaveBeenCalledTimes(2);
    expect(vscode.languages.registerDocumentLinkProvider).toHaveBeenCalledTimes(2);
  });
});
