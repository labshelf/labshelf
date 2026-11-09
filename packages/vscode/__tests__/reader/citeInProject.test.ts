// Tests the reader's "Cite in a project…": the pick it shows, the citation it inserts into the project's open editor, the copy when none is open, and the labshelf.bib entry.
import * as vscode from "vscode";
import type { ListedPaper } from "@labshelf/core";
import { createCiteInProject } from "../../src/reader/citeInProject";
import { fakeProjects, readyEntry } from "../support/writingFixtures";
import { paper } from "../support/citationFixtures";

const cited = paper({ id: "p1", citeKey: "smith2020", doi: "10.1/x", title: "A paper" });

function setup(papers?: ListedPaper[]) {
  const updateProjectSettings = jest.fn(async () => {});
  const project = readyEntry("/code/thesis", { main: "main.tex", settings: { id: "thesis", format: "latex", ...(papers ? { papers } : {}) } });
  const projects = { ...fakeProjects([project]), data: { updateProjectSettings }, reload: jest.fn(async () => {}) };
  const insertText = jest.fn();
  const view = { uri: vscode.Uri.file("/code/thesis/intro.tex"), line: () => 1, reveal: () => {}, updates: { insertText, insertSnippet: jest.fn(), wrap: jest.fn() } };
  return { updateProjectSettings, projects, insertText, view };
}

const pick = (match: (label: string) => boolean) => (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: vscode.QuickPickItem[]) => items.find((item) => match(item.label)));

describe("cite in a project from the reader", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("inserts the citation with its page into the project's open LabShelf editor and updates labshelf.bib", async () => {
    const { projects, insertText, view } = setup();
    let labels: string[] = [];
    (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: vscode.QuickPickItem[]) => {
      labels = items.map((item) => item.label);
      return items.find((item) => item.label.includes("with the quotation"));
    });
    await createCiteInProject({ projects, activeSource: { current: () => view, listOpen: () => [view] } })(cited, { paperId: "p1", page: 4, quote: "A claim" });
    expect(labels).toEqual(["$(quote) Insert in intro.tex", "$(quote) Insert in intro.tex with the quotation", "$(book) Only add to labshelf.bib"]);
    expect(insertText).toHaveBeenCalledWith("``A claim''~\\cite[p.~4]{smith2020}");
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("labshelf.citations.updateBibliography", view.uri);
  });

  it("copies the citation and lists the paper when no source of the project is open", async () => {
    const { projects, updateProjectSettings } = setup();
    pick((label) => label.includes("Copy the citation"));
    await createCiteInProject({ projects, activeSource: { current: () => undefined, listOpen: () => [] } })(cited, { paperId: "p1", page: 2 });
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("\\cite[p.~2]{smith2020}");
    expect(updateProjectSettings).toHaveBeenCalledWith("/code/thesis", { papers: [{ key: "smith2020", doi: "10.1/x" }] });
  });

  it("asks for the project first when there are several, the current one first", async () => {
    const { projects, view } = setup();
    const other = readyEntry("/code/talk", { main: "main.typ", settings: { id: "talk", format: "typst" } });
    const both = { ...projects, ...fakeProjects([other, ...projects.list()]) };
    let labels: string[] = [];
    (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: vscode.QuickPickItem[]) => { labels = items.map((item) => item.label); return undefined; });
    await createCiteInProject({ projects: both, activeSource: { current: () => view, listOpen: () => [view] } })(cited, { paperId: "p1" });
    expect(labels).toEqual(["$(folder) thesis", "$(folder) talk"]);
  });

  it("adds the paper to labshelf.bib without citing it, and offers no add once it is listed", async () => {
    const { projects, updateProjectSettings, insertText, view } = setup();
    pick((label) => label.includes("Only add to labshelf.bib"));
    await createCiteInProject({ projects, activeSource: { current: () => view, listOpen: () => [view] } })(cited, { paperId: "p1" });
    expect(updateProjectSettings).toHaveBeenCalledWith("/code/thesis", { papers: [{ key: "smith2020", doi: "10.1/x" }] });
    expect(insertText).not.toHaveBeenCalled();

    const listed = setup([{ key: "smith2020" }]);
    let labels: string[] = [];
    (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: vscode.QuickPickItem[]) => { labels = items.map((item) => item.label); return undefined; });
    await createCiteInProject({ projects: listed.projects, activeSource: { current: () => undefined, listOpen: () => [] } })(cited, { paperId: "p1" });
    expect(labels).toEqual(["$(copy) Copy the citation"]);
  });
});
