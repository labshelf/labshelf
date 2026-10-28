// Tests the LaTeX project sources: preferring open documents, following the include tree and refreshing when a project file changes.
import * as vscode from "vscode";

import { createProjectSourceReader } from "../../src/latex/project";
import { at, latexProject, resetOpenDocuments, restoreDiskReads, ROOT } from "../support/latexProjectFixtures";
import { fakeDocument } from "../support/textDocument";
import { fakeLogger } from "../support/writingFixtures";

// Tests that project sources prefer open documents, follow the include tree and refresh when a project file changes.
describe("project sources", () => {
  interface Watcher { _fire(kind: string, uri: vscode.Uri): void }

  const DISK = {
    "main.tex": "\\documentclass{article}\n\\begin{document}\n\\input{sections/a}\n\\input{gone}\n\\end{document}",
    "sections/a.tex": "\\section{A}\\label{sec:a}",
  };

  afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

  describe("createProjectSourceReader", () => {
    it("prefers the text of an open document over the file on disk", async () => {
      latexProject({ "main.tex": "on disk" });
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [fakeDocument(at("main.tex"), "unsaved")];
      const reader = createProjectSourceReader(vscode.Uri.file(ROOT), () => undefined);
      expect(await reader.read("main.tex")).toBe("unsaved");
    });

    it("reads closed files from disk and reports a missing file as undefined without logging", async () => {
      latexProject({ "main.tex": "on disk" });
      const logger = fakeLogger();
      const reader = createProjectSourceReader(vscode.Uri.file(ROOT), () => logger);
      expect(await reader.read("main.tex")).toBe("on disk");
      expect(await reader.read("absent.tex")).toBeUndefined();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("logs a read failure other than a missing file", async () => {
      latexProject({});
      (vscode.workspace.fs.readFile as jest.Mock).mockRejectedValue(Object.assign(new Error("denied"), { code: "NoPermissions" }));
      const logger = fakeLogger();
      const reader = createProjectSourceReader(vscode.Uri.file(ROOT), () => logger);
      expect(await reader.read("main.tex")).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith("writing/latex-editing", expect.any(Error), { action: "read", file: at("main.tex") });
    });
  });

  describe("LatexProjectSources", () => {
    it("collects the main file, its includes and the missing ones with their texts", async () => {
      const { sources, open } = latexProject(DISK);
      const project = (await sources.projectSourcesFor(open("sections/a.tex")))!;
      expect(project.root.fsPath).toBe(ROOT);
      expect(project.main).toBe("main.tex");
      expect(project.files.map((file) => file.path)).toEqual(["main.tex", "sections/a.tex"]);
      expect(project.missing.map((miss) => miss.path)).toEqual(["gone.tex"]);
      expect(project.texts.get("sections/a.tex")).toBe(DISK["sections/a.tex"]);
    });

    it("answers nothing for files outside a project, other formats, non-files and projects without a main file", async () => {
      const { sources } = latexProject(DISK);
      expect(await sources.projectSourcesFor({ uri: vscode.Uri.file("/elsewhere/a.tex") })).toBeUndefined();
      expect(await sources.projectSourcesFor({ uri: vscode.Uri.file(at("notes.md")) })).toBeUndefined();
      expect(await sources.projectSourcesFor({ uri: Object.assign(vscode.Uri.file(at("a.tex")), { scheme: "untitled" }) })).toBeUndefined();
      const noMain = latexProject(DISK, { main: undefined });
      expect(await noMain.sources.projectSourcesFor({ uri: vscode.Uri.file(at("a.tex")) })).toBeUndefined();
    });

    it("reads each project once until one of its files changes, then reads again and announces the folder", async () => {
      const { sources, edit, disk } = latexProject(DISK);
      const changed = jest.fn();
      sources.onDidChange(changed);
      const document = fakeDocument(at("sections/a.tex"), DISK["sections/a.tex"]);
      const first = await sources.projectSourcesFor(document);
      expect(await sources.projectSourcesFor(document)).toBe(first);
      disk["sections/a.tex"] = "\\section{B}";
      edit(document);
      expect(changed).toHaveBeenCalledWith(ROOT);
      const second = (await sources.projectSourcesFor(document))!;
      expect(second).not.toBe(first);
      expect(second.files[1]!.facts.sections[0]!.title).toBe("B");
    });

    it("refreshes on save, close and file watcher events, and ignores changes outside any project", async () => {
      const { sources, open } = latexProject(DISK);
      const changed = jest.fn();
      sources.onDidChange(changed);
      const document = open("main.tex");
      const workspace = vscode.workspace as unknown as { _fireDocumentEvent: (kind: string, doc: unknown) => void };
      workspace._fireDocumentEvent("save", document);
      workspace._fireDocumentEvent("close", document);
      (vscode as unknown as { _fileWatchers: Watcher[] })._fileWatchers.at(-1)!._fire("create", vscode.Uri.file(at("new.tex")));
      expect(changed).toHaveBeenCalledTimes(3);
      workspace._fireDocumentEvent("save", fakeDocument("/elsewhere/x.tex", ""));
      expect(changed).toHaveBeenCalledTimes(3);
    });

    it("announces every LaTeX project when the project list changes", async () => {
      const { sources, projects } = latexProject(DISK);
      const changed = jest.fn();
      sources.onDidChange(changed);
      projects.changes.fire();
      expect(changed).toHaveBeenCalledWith(ROOT);
    });
  });
});
