// Tests the deck Reopen commands: a deck switches between the text editor and the deck editor, closing the tab it came from.
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { registerDeckReopen } from "../../../src/writing/deckEditor/index";

jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  // Mock gap: window.tabGroups.activeTabGroup and its change events, which the active deck kind follows.
  actual.window.tabGroups.activeTabGroup = { activeTab: undefined };
  actual.window.tabGroups.onDidChangeTabs = () => ({ dispose: () => undefined });
  actual.window.tabGroups.onDidChangeTabGroups = () => ({ dispose: () => undefined });
  return actual;
});

const pkgRoot = path.resolve(__dirname, "../../..");
const deckUri = vscode.Uri.file("/library/projects/p/talks/intro/deck.html");

type Tabs = { activeTabGroup: { activeTab: unknown }; close: jest.Mock };
const tabs = () => vscode.window.tabGroups as unknown as Tabs;

function handler(id: string): (uri?: vscode.Uri) => Promise<unknown> {
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find((entry) => entry[0] === id);
  if (!call) { throw new Error(`${id} was not registered`); }
  return call[1];
}

function setup() {
  const context = { subscriptions: [] as vscode.Disposable[] };
  registerDeckReopen(context as never);
  return { asDeck: handler("labshelf.decks.reopenAsDeck"), asText: handler("labshelf.decks.reopenAsText") };
}

beforeEach(() => {
  jest.clearAllMocks();
  tabs().activeTabGroup = { activeTab: undefined };
});

describe("deck reopen commands", () => {
  it("8.3d reopenAsDeck opens the deck with labshelf.deckEditor", async () => {
    const { asDeck } = setup();
    await asDeck(deckUri);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.openWith", deckUri, "labshelf.deckEditor");
  });

  it("8.3d reopenAsText opens the deck with the default text editor", async () => {
    const { asText } = setup();
    await asText(deckUri);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.openWith", deckUri, "default");
  });

  it("8.3d reopenAsDeck closes the text tab the deck was reopened from", async () => {
    const tab = { input: new vscode.TabInputText(deckUri) };
    tabs().activeTabGroup = { activeTab: tab };
    const { asDeck } = setup();
    await asDeck(deckUri);
    expect(tabs().close).toHaveBeenCalledWith(tab, true);
  });

  it("8.3d reopenAsText closes the deck editor tab the deck was reopened from", async () => {
    const tab = { input: { uri: deckUri, viewType: "labshelf.deckEditor" } };
    tabs().activeTabGroup = { activeTab: tab };
    const { asText } = setup();
    await asText(deckUri);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.openWith", deckUri, "default");
    expect(tabs().close).toHaveBeenCalledWith(tab, true);
  });

  it("8.3d without a uri reopens the active tab's file", async () => {
    const tab = { input: new vscode.TabInputText(deckUri) };
    tabs().activeTabGroup = { activeTab: tab };
    const { asDeck } = setup();
    await asDeck();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.openWith", deckUri, "labshelf.deckEditor");
  });

  it("8.3d package.json declares the reopen commands", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
    const ids = (manifest.contributes.commands as Array<{ command: string }>).map((entry) => entry.command);
    expect(ids).toEqual(expect.arrayContaining(["labshelf.decks.reopenAsDeck", "labshelf.decks.reopenAsText"]));
  });
});
