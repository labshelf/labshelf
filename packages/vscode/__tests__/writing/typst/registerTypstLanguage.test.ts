// Tests that Typst sources list project files without dot folders and prefer unsaved editor text when reading.
import * as vscode from "vscode";

import {
  createTypstSources,
  createTypstLanguageOf,
} from "../../../src/writing/typst/registerTypstLanguage";
import { fakeDocument } from "../../support/textDocument";
import { fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

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
