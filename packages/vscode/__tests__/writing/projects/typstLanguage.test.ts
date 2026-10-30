// Tests the Typst language registration: sources list project files without dot folders and prefer unsaved editor text, roots follow the owning project, and the providers map the language service's offsets, kinds, snippets and files to VS Code types.
import * as vscode from "vscode";

import type { TypstLanguageService } from "@labshelf/core/typst/language";
import {
  createTypstCompletionProvider,
  createTypstDefinitionProvider,
  createTypstHoverProvider,
  createTypstLanguageOf,
  createTypstSources,
  type TypstLanguageOf,
} from "../../../src/writing/projects/typstLanguage";
import { fakeDocument } from "../../support/textDocument";
import { fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

describe("Typst sources and roots", () => {
  const fsMock = vscode.workspace.fs as unknown as { readDirectory: jest.Mock; readFile: jest.Mock };
  const workspace = vscode.workspace as unknown as { textDocuments: unknown[]; getWorkspaceFolder?: jest.Mock };
  const tree: Record<string, Array<[string, number]>> = {
    "/p": [["main.typ", 1], ["lib", 2], [".git", 2], ["node_modules", 2], [".hidden.typ", 1]],
    "/p/lib": [["util.typ", 1]],
  };

  beforeEach(() => {
    workspace.textDocuments = [];
    fsMock.readDirectory.mockImplementation(async (uri: vscode.Uri) => tree[uri.fsPath] ?? []);
    fsMock.readFile.mockImplementation(async (uri: vscode.Uri) => new TextEncoder().encode(`disk:${uri.fsPath}`));
  });

  describe("createTypstSources", () => {
    const sources = createTypstSources(vscode.Uri.file("/p"));

    it("lists files with project-relative / paths and skips dot entries and node_modules", async () => {
      expect((await sources.list()).sort()).toEqual(["lib/util.typ", "main.typ"]);
    });

    it("reads the unsaved text of an open document, else the file on disk", async () => {
      workspace.textDocuments = [fakeDocument("/p/lib/util.typ", "unsaved")];
      expect(await sources.read("lib/util.typ")).toBe("unsaved");
      expect(await sources.read("main.typ")).toBe("disk:/p/main.typ");
    });

    it("has no files without a folder", async () => {
      const none = createTypstSources(undefined);
      expect(await none.list()).toEqual([]);
      await expect(none.read("a.typ")).rejects.toThrow("No project folder");
    });
  });

  describe("createTypstLanguageOf", () => {
    const projects = fakeProjects([readyEntry("/lib/projects/paper", { main: "main.typ" })]);

    it("uses the owning project folder as root and a project-relative path", () => {
      const contextOf = createTypstLanguageOf(projects, fakeLogger());
      const first = contextOf(fakeDocument("/lib/projects/paper/sections/a.typ", ""));
      expect(first.root?.fsPath).toBe("/lib/projects/paper");
      expect(first.path).toBe("sections/a.typ");
      expect(contextOf(fakeDocument("/lib/projects/paper/main.typ", "")).service).toBe(first.service);
    });

    it("falls back to the workspace folder, then to the document's own folder", () => {
      const contextOf = createTypstLanguageOf(projects, fakeLogger());
      workspace.getWorkspaceFolder = jest.fn(() => ({ uri: vscode.Uri.file("/ws") }));
      expect(contextOf(fakeDocument("/ws/sub/b.typ", "")).path).toBe("sub/b.typ");
      workspace.getWorkspaceFolder = jest.fn(() => undefined);
      const alone = contextOf(fakeDocument("/other/c.typ", ""));
      expect([alone.root?.fsPath, alone.path]).toEqual(["/other", "c.typ"]);
    });
  });
});

describe("Typst providers", () => {
  const TEXT = "= Intro\n#le";
  const document = fakeDocument("/p/main.typ", TEXT);
  const token = undefined as never;

  function setup(service: Partial<TypstLanguageService>): TypstLanguageOf {
    return () => ({ service: service as TypstLanguageService, path: "main.typ", root: vscode.Uri.file("/p") });
  }

  describe("createTypstCompletionProvider", () => {
    const triggered = { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: "#" };

    it("passes UTF-16 offsets and the explicit flag, and maps ranges, kinds and snippets", async () => {
      const complete = jest.fn(async () => ({
        from: 9, to: 11,
        options: [
          { label: "let", kind: "keyword" as const, insert: "let ${1:name} = ${2}", snippet: true, detail: "binding", doc: "Binds." },
          { label: "main.typ", kind: "file" as const, insert: "main.typ", snippet: false },
        ],
      }));
      const provider = createTypstCompletionProvider(setup({ complete }));
      const items = await provider.provideCompletionItems(document, new vscode.Position(1, 3), token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined }) as vscode.CompletionItem[];
      expect(complete).toHaveBeenCalledWith("main.typ", TEXT, 11, true);
      expect(items.map((item) => item.kind)).toEqual([vscode.CompletionItemKind.Keyword, vscode.CompletionItemKind.File]);
      expect(items[0]!.range).toEqual(new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 3)));
      expect(items[0]!.insertText).toEqual(new vscode.SnippetString("let ${1:name} = ${2}"));
      expect(items[0]!.detail).toBe("binding");
      expect((items[0]!.documentation as vscode.MarkdownString).value).toBe("Binds.");
      expect(items[1]!.insertText).toBe("main.typ");
      expect(items.map((item) => item.sortText)).toEqual(["00000", "00001"]);
    });

    it("is not explicit for a trigger character and offers nothing when the service has nothing", async () => {
      const complete = jest.fn(async () => null);
      const provider = createTypstCompletionProvider(setup({ complete }));
      expect(await provider.provideCompletionItems(document, new vscode.Position(1, 0), token, triggered)).toBeUndefined();
      expect(complete).toHaveBeenCalledWith("main.typ", TEXT, 8, false);
    });
  });

  describe("createTypstHoverProvider", () => {
    it("returns the markdown over the range of the hovered symbol", async () => {
      const hover = jest.fn(async () => ({ from: 0, to: 7, text: "```typst\nheading\n```" }));
      const result = await createTypstHoverProvider(setup({ hover })).provideHover(document, new vscode.Position(0, 2), token) as vscode.Hover;
      expect(hover).toHaveBeenCalledWith("main.typ", TEXT, 2);
      expect((result.contents as unknown as vscode.MarkdownString).value).toBe("```typst\nheading\n```");
      expect(result.range).toEqual(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 7)));
    });
  });

  describe("createTypstDefinitionProvider", () => {
    it("locates a definition in the same document without opening it", async () => {
      const definition = jest.fn(async () => ({ path: "main.typ", from: 2, to: 7, line: 0 }));
      const open = jest.fn();
      (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = open;
      const location = await createTypstDefinitionProvider(setup({ definition })).provideDefinition(document, new vscode.Position(1, 1), token) as vscode.Location;
      expect(location.uri.fsPath).toBe("/p/main.typ");
      expect(location.range).toEqual(new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 7)));
      expect(open).not.toHaveBeenCalled();
    });

    it("maps offsets through the text of a definition in another project file", async () => {
      const definition = jest.fn(async () => ({ path: "lib/util.typ", from: 4, to: 6, line: 1 }));
      const other = fakeDocument("/p/lib/util.typ", "ab\ncdef");
      (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = jest.fn(async () => other);
      const location = await createTypstDefinitionProvider(setup({ definition })).provideDefinition(document, new vscode.Position(1, 1), token) as vscode.Location;
      expect(location.uri.fsPath).toBe("/p/lib/util.typ");
      expect(location.range).toEqual(new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 3)));
    });

    it("answers nothing when the service finds no definition", async () => {
      expect(await createTypstDefinitionProvider(setup({ definition: async () => null })).provideDefinition(document, new vscode.Position(0, 0), token)).toBeUndefined();
    });
  });
});
