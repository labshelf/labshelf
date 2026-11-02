// Tests Present: the audience and presenter panels, the host relay of presenter messages between them, moving the audience panel to a new window, closing both together, and refusing a poster.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { registerDeckCommands, type DeckCommandDeps } from "../../../src/writing/deckEditor/commands";
import { openPresenterPanels, relayPresenter } from "../../../src/writing/deckEditor/presenter";
import { commandHandler, fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

// Mock gaps the implementation may reach: Uri.prototype.with and window.tabGroups.activeTabGroup.
const uriProto = (vscode.Uri as unknown as { prototype: Record<string, unknown> }).prototype;
if (typeof uriProto.with !== "function") {
  uriProto.with = function withChange(this: vscode.Uri, change: Partial<Record<"scheme" | "authority" | "path" | "query" | "fragment", string>>) {
    const next = vscode.Uri.file(change.path ?? this.path) as unknown as Record<string, string>;
    next.scheme = change.scheme ?? this.scheme;
    next.authority = change.authority ?? this.authority;
    next.query = change.query ?? this.query;
    next.fragment = change.fragment ?? this.fragment;
    return next;
  };
}
const tabGroups = vscode.window.tabGroups as unknown as Record<string, unknown>;
tabGroups.activeTabGroup ??= { activeTab: undefined, tabs: [] };

const MOVE_TO_NEW_WINDOW = "workbench.action.moveEditorToNewWindow";

type MockPanel = vscode.WebviewPanel & {
  webview: vscode.Webview & { _fireMessage: (message: unknown) => void; postMessage: jest.Mock };
  dispose: jest.Mock;
};

/** A webview whose received messages tests fire by hand; disposing a subscription removes its listener. */
function fakeWebview() {
  const listeners = new Set<(message: unknown) => void>();
  return {
    postMessage: jest.fn(async () => true),
    onDidReceiveMessage: jest.fn((listener: (message: unknown) => void) => {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    }),
    fire: (message: unknown) => [...listeners].forEach((listener) => listener(message)),
  };
}

function useDiskWorkspaceFs(): void {
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
    const stat = fs.statSync(uri.fsPath, { throwIfNoEntry: false });
    if (!stat) { throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: "FileNotFound" }); }
    return { type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File, ctime: 0, mtime: 0, size: stat.size };
  });
  (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) =>
    fs.readdirSync(uri.fsPath, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File]));
  (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => Buffer.from(fs.readFileSync(uri.fsPath)));
}

function writeDeck(projectDir: string, kind: "talk" | "poster", name: string): vscode.Uri {
  const folder = path.join(projectDir, kind === "talk" ? "talks" : "posters", name);
  fs.mkdirSync(folder, { recursive: true });
  const size = kind === "talk" ? "1920x1080px" : "841x1189mm";
  const notes = kind === "talk" ? "<aside data-notes></aside>" : "";
  fs.writeFileSync(path.join(folder, "deck.html"), [
    "<!doctype html>",
    `<html lang="en" data-deck="${kind}" data-deck-version="1" data-deck-size="${size}">`,
    '<head><meta charset="utf-8"><title>x</title><link rel="stylesheet" href="theme.css" data-deck-theme></head>',
    `<body><section data-slide><div data-block="title" style="left: 10px; top: 10px; width: 100px; height: 50px;"><h1>x</h1></div>${notes}</section></body>`,
    "</html>",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(folder, "theme.css"), ":root {\n  --deck-bg: #ffffff;\n}\n");
  return vscode.Uri.file(path.join(folder, "deck.html"));
}

describe("relayPresenter", () => {
  beforeEach(() => jest.clearAllMocks());

  it("8.2c forwards a presenter message from the first webview to the second unchanged", () => {
    const a = fakeWebview();
    const b = fakeWebview();
    relayPresenter(a as never, b as never);
    const message = { type: "presenter", message: { type: "action", action: { kind: "next" } } };
    a.fire(message);
    expect(b.postMessage).toHaveBeenCalledTimes(1);
    expect(b.postMessage).toHaveBeenCalledWith(message);
    expect(a.postMessage).not.toHaveBeenCalled();
  });

  it("8.2c forwards a presenter message from the second webview to the first unchanged", () => {
    const a = fakeWebview();
    const b = fakeWebview();
    relayPresenter(a as never, b as never);
    const message = { type: "presenter", message: { type: "state", state: { slide: 2, count: 5, black: false, startedAt: 10, pausedAt: null, pausedTotal: 0 } } };
    b.fire(message);
    expect(a.postMessage).toHaveBeenCalledTimes(1);
    expect(a.postMessage).toHaveBeenCalledWith(message);
    expect(b.postMessage).not.toHaveBeenCalled();
  });

  it("8.2c drops messages whose type is not presenter", () => {
    const a = fakeWebview();
    const b = fakeWebview();
    relayPresenter(a as never, b as never);
    a.fire({ type: "ready" });
    a.fire({ type: "calibration", action: "load" });
    b.fire({ message: { type: "hello" } });
    b.fire("presenter");
    b.fire(null);
    expect(a.postMessage).not.toHaveBeenCalled();
    expect(b.postMessage).not.toHaveBeenCalled();
  });

  it("8.2c stops relaying once disposed", () => {
    const a = fakeWebview();
    const b = fakeWebview();
    relayPresenter(a as never, b as never).dispose();
    a.fire({ type: "presenter", message: { type: "hello" } });
    b.fire({ type: "presenter", message: { type: "exit" } });
    expect(a.postMessage).not.toHaveBeenCalled();
    expect(b.postMessage).not.toHaveBeenCalled();
  });
});

describe("openPresenterPanels and Present", () => {
  let projectDir: string;
  let deps: DeckCommandDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    useDiskWorkspaceFs();
    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async () => undefined);
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-present-")));
    deps = { extensionUri: vscode.Uri.file("/ext"), projects: fakeProjects([readyEntry(projectDir)]) as never, logger: fakeLogger() };
  });

  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  const createdPanels = (): MockPanel[] => (vscode.window.createWebviewPanel as jest.Mock).mock.results.map((result) => result.value as MockPanel);

  it("8.2c opens two distinct webview panels with the same resource roots", async () => {
    const { audience, presenter } = await openPresenterPanels(writeDeck(projectDir, "talk", "demo"), deps);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(audience).not.toBe(presenter);
    expect(createdPanels()).toEqual(expect.arrayContaining([audience, presenter]));
    expect(audience.webview.html).not.toBe("");
    expect(presenter.webview.html).not.toBe("");
    expect(audience.webview.options.localResourceRoots).toEqual(presenter.webview.options.localResourceRoots);
  });

  it("8.2c relays presenter messages from the audience panel to the presenter panel", async () => {
    const { audience, presenter } = (await openPresenterPanels(writeDeck(projectDir, "talk", "demo"), deps)) as unknown as { audience: MockPanel; presenter: MockPanel };
    const message = { type: "presenter", message: { type: "hello" } };
    audience.webview._fireMessage(message);
    expect(presenter.webview.postMessage).toHaveBeenCalledWith(message);
  });

  it("8.2c relays presenter messages from the presenter panel to the audience panel", async () => {
    const { audience, presenter } = (await openPresenterPanels(writeDeck(projectDir, "talk", "demo"), deps)) as unknown as { audience: MockPanel; presenter: MockPanel };
    const message = { type: "presenter", message: { type: "action", action: { kind: "toggleBlack" } } };
    presenter.webview._fireMessage(message);
    expect(audience.webview.postMessage).toHaveBeenCalledWith(message);
  });

  it("8.2c moves the audience panel to a new window", async () => {
    await openPresenterPanels(writeDeck(projectDir, "talk", "demo"), deps);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(MOVE_TO_NEW_WINDOW);
  });

  it("8.2c keeps the audience panel when moving it to a new window fails", async () => {
    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async (id: string) => {
      if (id === MOVE_TO_NEW_WINDOW) { throw new Error("not supported"); }
      return undefined;
    });
    const { audience, presenter } = (await openPresenterPanels(writeDeck(projectDir, "talk", "demo"), deps)) as unknown as { audience: MockPanel; presenter: MockPanel };
    expect(audience.dispose).not.toHaveBeenCalled();
    expect(presenter.dispose).not.toHaveBeenCalled();
  });

  it("8.2c closing the audience panel closes the presenter panel", async () => {
    const { audience, presenter } = (await openPresenterPanels(writeDeck(projectDir, "talk", "demo"), deps)) as unknown as { audience: MockPanel; presenter: MockPanel };
    audience.dispose();
    expect(presenter.dispose).toHaveBeenCalled();
  });

  it("8.2c closing the presenter panel closes the audience panel", async () => {
    const { audience, presenter } = (await openPresenterPanels(writeDeck(projectDir, "talk", "demo"), deps)) as unknown as { audience: MockPanel; presenter: MockPanel };
    presenter.dispose();
    expect(audience.dispose).toHaveBeenCalled();
  });

  it("8.2c the Present command opens both panels for a talk", async () => {
    registerDeckCommands({ subscriptions: [], extensionUri: deps.extensionUri, globalState: { get: jest.fn(), update: jest.fn(async () => {}), keys: () => [], setKeysForSync: jest.fn() } } as never, deps);
    await commandHandler("labshelf.decks.present")(writeDeck(projectDir, "talk", "demo"));
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it("8.2c the Present command refuses a poster", async () => {
    registerDeckCommands({ subscriptions: [], extensionUri: deps.extensionUri, globalState: { get: jest.fn(), update: jest.fn(async () => {}), keys: () => [], setKeysForSync: jest.fn() } } as never, deps);
    await commandHandler("labshelf.decks.present")(writeDeck(projectDir, "poster", "big"));
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("Present works for talks; use Poster Preview for posters.");
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(MOVE_TO_NEW_WINDOW);
  });
});
