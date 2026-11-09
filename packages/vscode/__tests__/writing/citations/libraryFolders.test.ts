// Tests linking and unlinking library folders and the sync that updates linked projects when the library changes.
import * as vscode from "vscode";
import { registerLibraryFolderCommands, updateLinkedProjects, watchLinkedProjects } from "../../../src/writing/citations/libraryFolders";
import { createLibraryEvents } from "../../../src/library/events";
import { fakeLogger, fakeProjects, readyEntry, commandHandler } from "../../support/writingFixtures";
import { paper } from "../../support/citationFixtures";

const entry = (libraryFolders?: string[]) => readyEntry("/code/repo", { main: "main.tex", settings: { id: "repo", format: "latex", ...(libraryFolders ? { libraryFolders } : {}) } });

describe("linked library folders", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
  afterEach(() => { jest.useRealTimers(); });

  describe("the sync trigger", () => {
    it("updates only the ready projects that have linked folders, a second after a paper changes", () => {
      const events = createLibraryEvents();
      const updateProject = jest.fn(async () => {});
      const linked = entry(["ml"]);
      const projects = fakeProjects([linked, readyEntry("/code/other", { main: "main.tex", settings: { id: "other", format: "latex" } })]);
      watchLinkedProjects(events, projects, { updateProject });
      events.paperAdded.fire(paper());
      events.paperUpdated.fire(paper());
      events.paperDeleted.fire({ id: "p1" });
      jest.advanceTimersByTime(900);
      expect(updateProject).not.toHaveBeenCalled();
      jest.advanceTimersByTime(200);
      expect(updateProject).toHaveBeenCalledTimes(1);
      expect(updateProject).toHaveBeenCalledWith(linked);
    });

    it("does nothing when no project links a folder", async () => {
      const updateProject = jest.fn(async () => {});
      await updateLinkedProjects(fakeProjects([entry()]), { updateProject });
      expect(updateProject).not.toHaveBeenCalled();
    });
  });

  describe("the commands", () => {
    function register(libraryFolders?: string[]) {
      const updateProject = jest.fn(async () => {});
      const updateProjectSettings = jest.fn(async () => {});
      const projects = { ...fakeProjects([entry(libraryFolders)]), data: { updateProjectSettings }, reload: jest.fn(async () => {}) };
      const papers = [paper({ id: "a", path: "papers/ml/nets/a", citeKey: "a1" }), paper({ id: "b", path: "papers/ml/b", citeKey: "b1" })];
      const host = { current: () => ({ root: "/lib", logger: fakeLogger() }), require: async () => ({ root: "/lib", logger: fakeLogger() }) };
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      registerLibraryFolderCommands(
        { context, host, projects: projects as never, activeSource: { current: () => undefined }, listPapers: async () => papers, sync: { updateProject } },
        createLibraryEvents(),
      );
      return { updateProject, updateProjectSettings };
    }

    it("links a picked folder, updates the bibliography and tells the user how many papers it holds", async () => {
      const { updateProject, updateProjectSettings } = register();
      (vscode.window.showQuickPick as jest.Mock)
        .mockImplementationOnce(async (items: Array<{ project: unknown }>) => items[0])
        .mockImplementationOnce(async (items: Array<{ label: string; description: string }>) => {
          expect(items.map((item) => [item.label, item.description])).toEqual([["ml", "2 papers"], ["ml/nets", "1 paper"]]);
          return items[0];
        });
      await commandHandler("labshelf.writing.linkLibraryFolder")();
      expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { libraryFolders: ["ml"] });
      expect(updateProject).toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("2 papers from ml are in labshelf.bib.");
    });

    it("unlinks the folder a menu row names without asking, keeping the other folders", async () => {
      const { updateProjectSettings } = register(["ml", "vision"]);
      (vscode.window.showQuickPick as jest.Mock).mockClear();
      await commandHandler("labshelf.writing.unlinkLibraryFolder")(entry(["ml", "vision"]), "ml");
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { libraryFolders: ["vision"] });
    });

    it("unlinks a picked folder and removes the key when none is left", async () => {
      const { updateProjectSettings } = register(["ml"]);
      (vscode.window.showQuickPick as jest.Mock)
        .mockImplementationOnce(async (items: Array<{ project: unknown }>) => items[0])
        .mockImplementationOnce(async (items: Array<{ label: string }>) => items[0]);
      await commandHandler("labshelf.writing.unlinkLibraryFolder")();
      expect(updateProjectSettings).toHaveBeenCalledWith("/code/repo", { libraryFolders: undefined });
    });
  });
});
