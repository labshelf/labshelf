// Tests New Talk / New Poster through the template gallery panel: newDeck with a mocked openNewDeckPanel (which formats and kits it offers, which files it writes and opens for a choice, a null choice, no project) and openNewDeckPanel itself against the vscode webview panel mock (ready answered with init, a valid create resolved, an invalid one ignored, cancel and dispose resolving null).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { scaffoldDeckFromTemplate, type DeckKit, type DeckTemplateChoice, type DeckTemplateGalleryInit } from "@labshelf/core";
import { registerDeckCommands } from "../../../src/writing/deckEditor/commands";
import { commandHandler, fakeLogger, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/writing/deckEditor/newDeckPanel", () => ({ openNewDeckPanel: jest.fn() }));
import { openNewDeckPanel as mockedOpenPanel } from "../../../src/writing/deckEditor/newDeckPanel";

const realPanel = jest.requireActual<typeof import("../../../src/writing/deckEditor/newDeckPanel")>("../../../src/writing/deckEditor/newDeckPanel");

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

const DECK_EDITOR = "labshelf.deckEditor";
const panelMock = mockedOpenPanel as jest.Mock;

const A0_PORTRAIT = { w: 841, h: 1189, unit: "mm" as const };
const TALK_16_9 = { w: 1920, h: 1080, unit: "px" as const };
const KIT: DeckKit = {
  name: "Lab kit",
  style: { primary: "#112233", accent: "#aa2200", background: "#ffffff", text: "#1a1a1a", muted: "#6b7280", headingFont: "Inter", bodyFont: "Inter", monoFont: "JetBrains Mono", scale: 1 },
};

const betterPoster = (title = "Big Result", style: DeckTemplateChoice["style"] = null): DeckTemplateChoice =>
  ({ kind: "poster", format: "html", template: "better-poster", title, size: A0_PORTRAIT, style });
const latexTalk = (title = "My Talk"): DeckTemplateChoice =>
  ({ kind: "talk", format: "latex", template: "generic", title, size: TALK_16_9, style: null });
const typstTalk = (title = "Typst Talk"): DeckTemplateChoice =>
  ({ kind: "talk", format: "typst", template: "blank", title, size: TALK_16_9, style: null });

function makeProjectDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-newdeck-")));
}

function useDiskWorkspaceFs(): void {
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
    const stat = fs.statSync(uri.fsPath, { throwIfNoEntry: false });
    if (!stat) { throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: "FileNotFound" }); }
    return { type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File, ctime: 0, mtime: 0, size: stat.size };
  });
}

function fakeContext(): vscode.ExtensionContext {
  const globalState = { get: jest.fn((_key: string, fallback?: unknown) => fallback), update: jest.fn(async () => {}), keys: jest.fn(() => []), setKeysForSync: jest.fn() };
  return { subscriptions: [], extensionUri: vscode.Uri.file("/ext"), globalState } as unknown as vscode.ExtensionContext;
}

interface SetupOptions { format?: "latex" | "typst"; kits?: { list: jest.Mock }; withProject?: boolean }

function setup(projectDir: string, options: SetupOptions = {}) {
  const { format = "latex", kits, withProject = true } = options;
  const entry = readyEntry(projectDir, { settings: { id: "p", format } as never });
  const projects = fakeProjects([entry]);
  registerDeckCommands(fakeContext(), {
    extensionUri: vscode.Uri.file("/ext"), projects: projects as never, logger: fakeLogger(), session: { project: undefined },
    ...(kits ? { kits } : {}),
  } as never);
  if (withProject) { openInEditor(path.join(projectDir, "main.tex")); }
}

function writtenText(fsPath: string): string | undefined {
  const call = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls.find(([uri]) => (uri as vscode.Uri).fsPath === fsPath);
  return call ? Buffer.from(call[1] as Uint8Array).toString("utf8") : undefined;
}

const writtenPaths = (): string[] => (vscode.workspace.fs.writeFile as jest.Mock).mock.calls.map(([uri]) => (uri as vscode.Uri).fsPath);
const commandCall = (id: string) => (vscode.commands.executeCommand as jest.Mock).mock.calls.find(([name]) => name === id);

describe("New Talk and New Poster through the template gallery", () => {
  let projectDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    useDiskWorkspaceFs();
    panelMock.mockReset();
    panelMock.mockResolvedValue(null);
    (vscode.workspace.fs.writeFile as jest.Mock).mockImplementation(async () => {});
    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async () => undefined);
    (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;
    projectDir = makeProjectDir();
  });

  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  it("5.3a New Talk opens the panel with kind talk, html and the project's LaTeX format, and the kits", async () => {
    const kits = { list: jest.fn(async () => [KIT]) };
    setup(projectDir, { kits });
    await commandHandler("labshelf.decks.newTalk")();
    expect(panelMock).toHaveBeenCalledTimes(1);
    const [extensionUri, init] = panelMock.mock.calls[0] as [vscode.Uri, DeckTemplateGalleryInit];
    expect(extensionUri.fsPath).toBe("/ext");
    expect(init.kind).toBe("talk");
    expect(init.formats).toEqual(["html", "latex"]);
    expect(init.kits).toEqual([KIT]);
  });

  it("5.3a New Poster opens the panel with kind poster", async () => {
    setup(projectDir, { kits: { list: jest.fn(async () => []) } });
    await commandHandler("labshelf.decks.newPoster")();
    expect((panelMock.mock.calls[0]![1] as DeckTemplateGalleryInit).kind).toBe("poster");
  });

  it("5.3a the generic New command opens the panel without a kind", async () => {
    setup(projectDir);
    await commandHandler("labshelf.decks.new")();
    expect(panelMock).toHaveBeenCalledTimes(1);
    expect((panelMock.mock.calls[0]![1] as DeckTemplateGalleryInit).kind).toBeUndefined();
  });

  it("5.3a a Typst project offers html and typst", async () => {
    setup(projectDir, { format: "typst" });
    await commandHandler("labshelf.decks.newTalk")();
    expect((panelMock.mock.calls[0]![1] as DeckTemplateGalleryInit).formats).toEqual(["html", "typst"]);
  });

  it("5.3a offers no kits when the handler is absent", async () => {
    setup(projectDir);
    await commandHandler("labshelf.decks.newTalk")();
    expect((panelMock.mock.calls[0]![1] as DeckTemplateGalleryInit).kits).toEqual([]);
  });

  it("5.3a offers no kits, and still opens the panel, when listing the kits throws", async () => {
    setup(projectDir, { kits: { list: jest.fn(async () => { throw new Error("no library"); }) } });
    await commandHandler("labshelf.decks.newTalk")();
    expect(panelMock).toHaveBeenCalledTimes(1);
    expect((panelMock.mock.calls[0]![1] as DeckTemplateGalleryInit).kits).toEqual([]);
  });

  it("5.3a a Better Poster choice writes deck.html and theme.css under posters/<name>/", async () => {
    setup(projectDir);
    panelMock.mockResolvedValue(betterPoster("Big Result"));
    await commandHandler("labshelf.decks.newPoster")();
    const expected = scaffoldDeckFromTemplate(betterPoster("Big Result"), "big-result");
    expect(expected.map((file) => file.path).sort()).toEqual(["deck.html", "theme.css"]);
    const folder = path.join(projectDir, "posters", "big-result");
    expect(writtenPaths().sort()).toEqual([path.join(folder, "deck.html"), path.join(folder, "theme.css")]);
    for (const file of expected) {
      expect(writtenText(path.join(folder, file.path))).toBe(file.text);
    }
    expect(writtenText(path.join(folder, "deck.html"))).toContain('data-deck="poster"');
    expect(writtenText(path.join(folder, "theme.css"))).toContain("poster-takeaway");
  });

  it("5.3a a Better Poster choice opens deck.html in the deck editor", async () => {
    setup(projectDir);
    panelMock.mockResolvedValue(betterPoster("Big Result"));
    await commandHandler("labshelf.decks.newPoster")();
    const open = commandCall("vscode.openWith");
    expect(open).toBeDefined();
    expect((open![1] as vscode.Uri).fsPath).toBe(path.join(projectDir, "posters", "big-result", "deck.html"));
    expect(open![2]).toBe(DECK_EDITOR);
  });

  it("5.3a a talk choice goes under talks/", async () => {
    setup(projectDir);
    panelMock.mockResolvedValue({ kind: "talk", format: "html", template: "generic", title: "My Talk", size: TALK_16_9, style: null } satisfies DeckTemplateChoice);
    await commandHandler("labshelf.decks.newTalk")();
    expect(writtenText(path.join(projectDir, "talks", "my-talk", "deck.html"))).toContain('data-deck="talk"');
    expect(writtenText(path.join(projectDir, "talks", "my-talk", "theme.css"))).toBeDefined();
  });

  it("5.3a picks the first free folder name when the slug is taken", async () => {
    fs.mkdirSync(path.join(projectDir, "posters", "big-result"), { recursive: true });
    setup(projectDir);
    panelMock.mockResolvedValue(betterPoster("Big Result"));
    await commandHandler("labshelf.decks.newPoster")();
    expect(writtenText(path.join(projectDir, "posters", "big-result-2", "deck.html"))).toBeDefined();
    expect(writtenText(path.join(projectDir, "posters", "big-result", "deck.html"))).toBeUndefined();
  });

  it("5.3a no longer asks the quick picks or the title box", async () => {
    setup(projectDir);
    panelMock.mockResolvedValue(betterPoster());
    await commandHandler("labshelf.decks.newPoster")();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  it("5.3b a LaTeX talk choice writes talks/<name>/main.tex only", async () => {
    setup(projectDir);
    panelMock.mockResolvedValue(latexTalk("My Talk"));
    await commandHandler("labshelf.decks.newTalk")();
    const main = path.join(projectDir, "talks", "my-talk", "main.tex");
    expect(writtenPaths()).toEqual([main]);
    expect(writtenText(main)).toBe(scaffoldDeckFromTemplate(latexTalk("My Talk"), "my-talk")[0]!.text);
  });

  it("5.3b a LaTeX talk choice opens main.tex with vscode.open", async () => {
    setup(projectDir);
    panelMock.mockResolvedValue(latexTalk("My Talk"));
    await commandHandler("labshelf.decks.newTalk")();
    const open = commandCall("vscode.open");
    expect(open).toBeDefined();
    expect((open![1] as vscode.Uri).fsPath).toBe(path.join(projectDir, "talks", "my-talk", "main.tex"));
    expect(commandCall("vscode.openWith")).toBeUndefined();
  });

  it("5.3b a Typst talk choice writes and opens main.typ", async () => {
    setup(projectDir, { format: "typst" });
    panelMock.mockResolvedValue(typstTalk("Typst Talk"));
    await commandHandler("labshelf.decks.newTalk")();
    const main = path.join(projectDir, "talks", "typst-talk", "main.typ");
    expect(writtenPaths()).toEqual([main]);
    expect((commandCall("vscode.open")![1] as vscode.Uri).fsPath).toBe(main);
  });

  it("5.3b a null choice writes and opens nothing", async () => {
    setup(projectDir);
    panelMock.mockResolvedValue(null);
    await commandHandler("labshelf.decks.newTalk")();
    expect(panelMock).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(commandCall("vscode.open")).toBeUndefined();
    expect(commandCall("vscode.openWith")).toBeUndefined();
  });

  it("5.3b without a project it shows the warning and does not open the panel", async () => {
    setup(projectDir, { withProject: false });
    await commandHandler("labshelf.decks.newTalk")();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("Open a writing project first.");
    expect(panelMock).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("A6 New Talk shows the gallery panel with the library's Kits", async () => {
    const kits = { list: jest.fn(async () => [KIT]) };
    setup(projectDir, { kits });
    await commandHandler("labshelf.decks.newTalk")();
    expect(kits.list).toHaveBeenCalled();
    expect(panelMock).toHaveBeenCalledTimes(1);
    expect((panelMock.mock.calls[0]![1] as DeckTemplateGalleryInit).kits.map((kit) => kit.name)).toEqual(["Lab kit"]);
  });

  it("A6 a Kit's style chosen in the gallery is applied to the created deck", async () => {
    setup(projectDir);
    const choice = betterPoster("Kit Poster", KIT.style);
    panelMock.mockResolvedValue(choice);
    await commandHandler("labshelf.decks.newPoster")();
    const theme = writtenText(path.join(projectDir, "posters", "kit-poster", "theme.css"));
    expect(theme).toContain("labshelf:style");
    expect(theme).toBe(scaffoldDeckFromTemplate(choice, "kit-poster").find((file) => file.path === "theme.css")!.text);
  });
});

describe("openNewDeckPanel", () => {
  const EXT = vscode.Uri.file("/ext");
  const INIT: DeckTemplateGalleryInit = { kind: "talk", formats: ["html", "latex"], kits: [KIT] };
  const VALID_TALK: DeckTemplateChoice = { kind: "talk", format: "html", template: "generic", title: "Hello", size: TALK_16_9, style: null };
  const VALID_POSTER: DeckTemplateChoice = betterPoster("Poster");

  interface FakePanel {
    dispose: jest.Mock;
    webview: { postMessage: jest.Mock; _fireMessage: (message: unknown) => void };
  }

  /** Lets the panel's pending async work (bundle probe, message handlers) settle. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); }
  }

  /** Starts the panel and returns its result promise with the panel the mock created and a way to read whether it resolved. */
  async function open(init: DeckTemplateGalleryInit = INIT) {
    const result = realPanel.openNewDeckPanel(EXT, init);
    let settled = false;
    let value: DeckTemplateChoice | null | undefined;
    void result.then((v) => { settled = true; value = v; });
    await settle();
    const create = vscode.window.createWebviewPanel as jest.Mock;
    expect(create).toHaveBeenCalledTimes(1);
    const panel = create.mock.results[0]!.value as FakePanel;
    return { result, panel, isSettled: () => settled, value: () => value };
  }

  const send = async (panel: FakePanel, message: unknown): Promise<void> => { panel.webview._fireMessage(message); await settle(); };

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }));
  });

  it("5.3c creates the New talk or poster panel with scripts enabled in the active column", async () => {
    const { result, panel } = await open();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith("labshelf.newDeck", "New talk or poster", vscode.ViewColumn.Active, expect.objectContaining({ enableScripts: true }));
    await send(panel, { type: "cancel" });
    await result;
  });

  it("5.3c answers ready with init carrying the init object", async () => {
    const { result, panel } = await open();
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "init" }));
    await send(panel, { type: "ready" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "init", init: INIT });
    await send(panel, { type: "cancel" });
    await result;
  });

  it("5.3c resolves a valid create message with the choice and disposes the panel", async () => {
    const { result, panel } = await open();
    await send(panel, { type: "create", choice: VALID_TALK });
    await expect(result).resolves.toEqual(VALID_TALK);
    expect(panel.dispose).toHaveBeenCalled();
  });

  it("5.3c resolves a valid poster choice with a normalised title", async () => {
    const { result, panel } = await open({ kind: "poster", formats: ["html"], kits: [] });
    await send(panel, { type: "create", choice: { ...VALID_POSTER, title: "  Poster  " } });
    await expect(result).resolves.toEqual(VALID_POSTER);
  });

  it("5.3c ignores a create message with an unknown template and keeps waiting", async () => {
    const { result, panel, isSettled } = await open();
    await send(panel, { type: "create", choice: { ...VALID_TALK, template: "no-such-template" } });
    expect(isSettled()).toBe(false);
    expect(panel.dispose).not.toHaveBeenCalled();
    await send(panel, { type: "create", choice: VALID_TALK });
    await expect(result).resolves.toEqual(VALID_TALK);
  });

  it.each([
    ["an empty title", { ...VALID_TALK, title: "   " }],
    ["a disallowed size", { ...VALID_TALK, size: { w: 10, h: 10, unit: "px" } }],
    ["a missing choice", undefined],
    ["a null choice", null],
    ["a non-object choice", 42],
  ])("5.3c ignores a create message with %s", async (_label, choice) => {
    const { result, panel, isSettled } = await open();
    await send(panel, { type: "create", choice });
    expect(isSettled()).toBe(false);
    expect(panel.dispose).not.toHaveBeenCalled();
    await send(panel, { type: "cancel" });
    await expect(result).resolves.toBeNull();
  });

  it("5.3c resolves null on a cancel message and disposes the panel", async () => {
    const { result, panel } = await open();
    await send(panel, { type: "cancel" });
    await expect(result).resolves.toBeNull();
    expect(panel.dispose).toHaveBeenCalled();
  });

  it("5.3c resolves null when the user closes the panel", async () => {
    const { result, panel } = await open();
    panel.dispose();
    await settle();
    await expect(result).resolves.toBeNull();
  });

  it("5.3c resolves once: a choice already created is not replaced by a later cancel or dispose", async () => {
    const { result, panel } = await open();
    await send(panel, { type: "create", choice: VALID_TALK });
    await send(panel, { type: "cancel" });
    panel.dispose();
    await settle();
    await expect(result).resolves.toEqual(VALID_TALK);
  });

  it("5.3c resolves once: a second create after the first is ignored", async () => {
    const { result, panel } = await open();
    await send(panel, { type: "create", choice: VALID_TALK });
    await send(panel, { type: "create", choice: { ...VALID_TALK, title: "Second" } });
    await expect(result).resolves.toEqual(VALID_TALK);
  });

  it("A6 the panel hands the Kits to the gallery webview in init", async () => {
    const { result, panel } = await open({ kind: "poster", formats: ["html", "typst"], kits: [KIT] });
    await send(panel, { type: "ready" });
    const init = panel.webview.postMessage.mock.calls.map(([message]) => message as { type: string; init?: DeckTemplateGalleryInit }).find((message) => message.type === "init");
    expect(init?.init?.kits).toEqual([KIT]);
    expect(init?.init?.kind).toBe("poster");
    expect(init?.init?.formats).toEqual(["html", "typst"]);
    await send(panel, { type: "cancel" });
    await result;
  });
});
