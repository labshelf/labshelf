// Tests the Talks & Posters tree: the Talks and Posters groups of the active project, their decks by folder name, opening a deck with the deck editor, empty groups and refresh.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { createDecksTreeProvider, type DeckTreeItem, type DeckTreeNode } from "../../../src/writing/projects/decksTree";
import { fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

const DECK_EDITOR = "labshelf.deckEditor";

function writeDeck(projectDir: string, root: "talks" | "posters", name: string): void {
  const folder = path.join(projectDir, root, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "deck.html"), `<!doctype html>\n<html data-deck="${root === "talks" ? "talk" : "poster"}"><body><section data-slide></section></body></html>\n`);
  fs.writeFileSync(path.join(folder, "theme.css"), ":root {}\n");
}

type DecksProvider = vscode.TreeDataProvider<DeckTreeNode> & { refresh(): void };

// Typed through the seam signature so the test compiles whatever the provider module imports.
const makeProvider = (projectDir: string): DecksProvider =>
  createDecksTreeProvider(fakeProjects([readyEntry(projectDir)]) as never) as DecksProvider;

const labelOf = (item: vscode.TreeItem): string => (typeof item.label === "string" ? item.label : item.label?.label ?? "");

describe("createDecksTreeProvider", () => {
  let projectDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
      const stat = fs.statSync(uri.fsPath, { throwIfNoEntry: false });
      if (!stat) { throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: "FileNotFound" }); }
      return { type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File, ctime: 0, mtime: 0, size: stat.size };
    });
    (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) =>
      fs.readdirSync(uri.fsPath, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File]));
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-decks-tree-")));
    openInEditor(path.join(projectDir, "main.tex"));
  });

  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  async function groups(provider: DecksProvider): Promise<{ talks: DeckTreeNode; posters: DeckTreeNode }> {
    const roots: DeckTreeNode[] = (await provider.getChildren()) ?? [];
    const talks = roots.find((node: DeckTreeNode) => "group" in node && node.group === "talk");
    const posters = roots.find((node: DeckTreeNode) => "group" in node && node.group === "poster");
    expect(talks).toBeDefined();
    expect(posters).toBeDefined();
    return { talks: talks!, posters: posters! };
  }

  it("8.2b shows a Talks group and a Posters group at the root", async () => {
    const provider = makeProvider(projectDir);
    const roots: DeckTreeNode[] = (await provider.getChildren()) ?? [];
    expect(roots).toHaveLength(2);
    const labels = await Promise.all(roots.map(async (node: DeckTreeNode) => labelOf(await provider.getTreeItem(node))));
    expect(labels).toEqual(["Talks", "Posters"]);
  });

  it("8.2b lists the project's talks and posters by folder name", async () => {
    writeDeck(projectDir, "talks", "beta");
    writeDeck(projectDir, "talks", "alpha");
    writeDeck(projectDir, "posters", "summer-poster");
    const provider = makeProvider(projectDir);
    const { talks, posters } = await groups(provider);
    const talkItems = ((await provider.getChildren(talks)) ?? []) as DeckTreeItem[];
    const posterItems = ((await provider.getChildren(posters)) ?? []) as DeckTreeItem[];
    expect(talkItems.map((item: DeckTreeItem) => [item.kind, item.name])).toEqual([["talk", "alpha"], ["talk", "beta"]]);
    expect(posterItems.map((item: DeckTreeItem) => [item.kind, item.name])).toEqual([["poster", "summer-poster"]]);
    const labels = await Promise.all(talkItems.map(async (item: DeckTreeItem) => labelOf(await provider.getTreeItem(item))));
    expect(labels).toEqual(["alpha", "beta"]);
  });

  it("8.2b opens a deck with the deck editor", async () => {
    writeDeck(projectDir, "talks", "alpha");
    const provider = makeProvider(projectDir);
    const { talks } = await groups(provider);
    const [alpha] = ((await provider.getChildren(talks)) ?? []) as DeckTreeItem[];
    const item = await provider.getTreeItem(alpha!);
    expect(item.command?.command).toBe("vscode.openWith");
    const [uri, viewType] = item.command!.arguments as [vscode.Uri, string];
    expect(uri.fsPath).toBe(path.join(projectDir, "talks", "alpha", "deck.html"));
    expect(viewType).toBe(DECK_EDITOR);
  });

  it("8.2b shows one placeholder child in an empty group", async () => {
    writeDeck(projectDir, "talks", "alpha");
    const provider = makeProvider(projectDir);
    const { posters } = await groups(provider);
    const children = (await provider.getChildren(posters)) ?? [];
    expect(children).toHaveLength(1);
    expect(labelOf(await provider.getTreeItem(children[0]!))).toBe("No posters yet");
  });

  it("8.2b shows No talks yet when the project has no talks", async () => {
    const provider = makeProvider(projectDir);
    const { talks } = await groups(provider);
    const children = (await provider.getChildren(talks)) ?? [];
    expect(children).toHaveLength(1);
    expect(labelOf(await provider.getTreeItem(children[0]!))).toBe("No talks yet");
  });

  it("8.2b ignores folders without a deck.html or with an invalid deck name", async () => {
    writeDeck(projectDir, "talks", "alpha");
    fs.mkdirSync(path.join(projectDir, "talks", "draft"), { recursive: true });
    writeDeck(projectDir, "talks", "Bad Name");
    const provider = makeProvider(projectDir);
    const { talks } = await groups(provider);
    const items = ((await provider.getChildren(talks)) ?? []) as DeckTreeItem[];
    expect(items.map((item: DeckTreeItem) => item.name)).toEqual(["alpha"]);
  });

  it("8.2b refresh fires onDidChangeTreeData and the tree shows a deck added since", async () => {
    const provider = makeProvider(projectDir);
    const listener = jest.fn();
    provider.onDidChangeTreeData!(listener);
    writeDeck(projectDir, "posters", "late");
    provider.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    const { posters } = await groups(provider);
    const items = ((await provider.getChildren(posters)) ?? []) as DeckTreeItem[];
    expect(items.map((item: DeckTreeItem) => item.name)).toEqual(["late"]);
  });
});
