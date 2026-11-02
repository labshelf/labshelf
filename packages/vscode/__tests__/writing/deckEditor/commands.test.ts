// Tests the deck commands: deckFolderName, New Talk / New Poster scaffolding a deck into a free folder and opening it with the deck editor, and the package.json contributions.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { deckFolderName, registerDeckCommands } from "../../../src/writing/deckEditor/commands";
import { commandHandler, fakeLogger, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

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
const VALID_DECK_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Backs the workspace fs stat and readDirectory mocks with the real disk, so existence checks see the temp project. */
function useDiskWorkspaceFs(): void {
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
    const stat = fs.statSync(uri.fsPath, { throwIfNoEntry: false });
    if (!stat) { throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: "FileNotFound" }); }
    return { type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File, ctime: 0, mtime: 0, size: stat.size };
  });
  (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) =>
    fs.readdirSync(uri.fsPath, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File]));
}

function makeProjectDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-decks-")));
}

function writeDeck(projectDir: string, root: "talks" | "posters", name: string): void {
  const folder = path.join(projectDir, root, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "deck.html"), `<!doctype html>\n<html data-deck="${root === "talks" ? "talk" : "poster"}"><body><section data-slide></section></body></html>\n`);
  fs.writeFileSync(path.join(folder, "theme.css"), ":root {}\n");
}

function fakeContext(): vscode.ExtensionContext {
  const values = new Map<string, unknown>();
  const globalState = {
    get: jest.fn((key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback)),
    update: jest.fn(async (key: string, value: unknown) => { values.set(key, value); }),
    keys: jest.fn(() => [...values.keys()]),
    setKeysForSync: jest.fn(),
  };
  return { subscriptions: [], extensionUri: vscode.Uri.file("/ext"), globalState } as unknown as vscode.ExtensionContext;
}

function setup(projectDir: string) {
  const projects = fakeProjects([readyEntry(projectDir)]);
  const logger = fakeLogger();
  registerDeckCommands(fakeContext(), { extensionUri: vscode.Uri.file("/ext"), projects: projects as never, logger });
  return { projects, logger };
}

/** showQuickPick resolves to the offered item with this label. */
function pickLabel(label: string): void {
  (vscode.window.showQuickPick as jest.Mock).mockImplementation(async (items: unknown) => {
    const list = (await items) as Array<string | { label: string }>;
    return list.find((item) => (typeof item === "string" ? item : item.label) === label);
  });
}

function offeredLabels(): string[] {
  const items = (vscode.window.showQuickPick as jest.Mock).mock.calls[0]![0] as Array<string | { label: string }>;
  return items.map((item) => (typeof item === "string" ? item : item.label));
}

function writtenText(fsPath: string): string | undefined {
  const call = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls.find(([uri]) => (uri as vscode.Uri).fsPath === fsPath);
  return call ? Buffer.from(call[1] as Uint8Array).toString("utf8") : undefined;
}

describe("deckFolderName", () => {
  it("8.2a lowercases and joins words with one hyphen", () => {
    expect(deckFolderName("My Talk")).toBe("my-talk");
    expect(deckFolderName("Results  &  Discussion")).toBe("results-discussion");
  });

  it("8.2a removes accents through NFKD and expands compatibility characters", () => {
    expect(deckFolderName("Café Über 2024!")).toBe("cafe-uber-2024");
    expect(deckFolderName("ﬁle")).toBe("file");
  });

  it("8.2a trims hyphens at both ends", () => {
    expect(deckFolderName("  --Hello__World--  ")).toBe("hello-world");
  });

  it("8.2a cuts to 40 characters and trims a trailing hyphen left by the cut", () => {
    expect(deckFolderName(`${"a".repeat(39)} b c`)).toBe("a".repeat(39));
    expect(deckFolderName("b".repeat(60))).toBe("b".repeat(40));
  });

  it("8.2a falls back to deck when nothing is left", () => {
    expect(deckFolderName("")).toBe("deck");
    expect(deckFolderName("!!! ???")).toBe("deck");
    expect(deckFolderName("日本語")).toBe("deck");
  });

  it("8.2a always gives a valid deck name", () => {
    for (const title of ["My Talk", "", "-", "Ünïcödé — títle", "x".repeat(200), "  42  ", "a-b--c"]) {
      expect(deckFolderName(title)).toMatch(VALID_DECK_NAME);
    }
  });
});

describe("New Talk and New Poster", () => {
  let projectDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    useDiskWorkspaceFs();
    (vscode.workspace.fs.writeFile as jest.Mock).mockImplementation(async () => {});
    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async () => undefined);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
    (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;
    projectDir = makeProjectDir();
  });

  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  it("8.2a New Talk asks for a talk title and offers the talk size presets", async () => {
    setup(projectDir);
    openInEditor(path.join(projectDir, "main.tex"));
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue("My Talk");
    pickLabel("16:9");
    await commandHandler("labshelf.decks.newTalk")();
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ title: "Talk title" }));
    expect(offeredLabels()).toEqual(["16:9", "4:3", "16:10"]);
  });

  it("8.2a New Talk writes talks/<name>/deck.html and theme.css from scaffoldDeck", async () => {
    setup(projectDir);
    openInEditor(path.join(projectDir, "main.tex"));
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue("My Talk");
    pickLabel("4:3");
    await commandHandler("labshelf.decks.newTalk")();
    const html = writtenText(path.join(projectDir, "talks", "my-talk", "deck.html"));
    const theme = writtenText(path.join(projectDir, "talks", "my-talk", "theme.css"));
    expect(html).toContain('data-deck="talk"');
    expect(html).toContain('data-deck-size="1440x1080px"');
    expect(html).toContain("<title>my-talk</title>");
    expect(theme).toContain(":root {");
    expect(theme).toContain("--deck-accent");
  });

  it("8.2a New Talk picks the first free folder name when the slug is taken", async () => {
    writeDeck(projectDir, "talks", "my-talk");
    writeDeck(projectDir, "talks", "my-talk-2");
    setup(projectDir);
    openInEditor(path.join(projectDir, "main.tex"));
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue("My Talk");
    pickLabel("16:9");
    await commandHandler("labshelf.decks.newTalk")();
    const html = writtenText(path.join(projectDir, "talks", "my-talk-3", "deck.html"));
    expect(html).toContain("<title>my-talk-3</title>");
    expect(html).toContain('data-deck-size="1920x1080px"');
    expect(writtenText(path.join(projectDir, "talks", "my-talk-3", "theme.css"))).toBeDefined();
    expect(writtenText(path.join(projectDir, "talks", "my-talk", "deck.html"))).toBeUndefined();
    expect(writtenText(path.join(projectDir, "talks", "my-talk-2", "deck.html"))).toBeUndefined();
  });

  it("8.2a New Talk opens the new deck with the deck editor", async () => {
    setup(projectDir);
    openInEditor(path.join(projectDir, "main.tex"));
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue("My Talk");
    pickLabel("16:9");
    await commandHandler("labshelf.decks.newTalk")();
    const open = (vscode.commands.executeCommand as jest.Mock).mock.calls.find(([id]) => id === "vscode.openWith");
    expect(open).toBeDefined();
    expect((open![1] as vscode.Uri).fsPath).toBe(path.join(projectDir, "talks", "my-talk", "deck.html"));
    expect(open![2]).toBe(DECK_EDITOR);
  });

  it("8.2a New Talk without an active project warns and writes nothing", async () => {
    setup(projectDir);
    await commandHandler("labshelf.decks.newTalk")();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("Open a writing project first.");
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("8.2a New Poster writes posters/<name>/ with the picked poster size and opens it", async () => {
    setup(projectDir);
    openInEditor(path.join(projectDir, "main.tex"));
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue("Big Poster");
    pickLabel("A1 landscape");
    await commandHandler("labshelf.decks.newPoster")();
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ title: "Poster title" }));
    expect(offeredLabels()).toContain("A0 portrait");
    const html = writtenText(path.join(projectDir, "posters", "big-poster", "deck.html"));
    expect(html).toContain('data-deck="poster"');
    expect(html).toContain('data-deck-size="841x594mm"');
    expect(writtenText(path.join(projectDir, "posters", "big-poster", "theme.css"))).toContain(":root {");
    const open = (vscode.commands.executeCommand as jest.Mock).mock.calls.find(([id]) => id === "vscode.openWith");
    expect((open![1] as vscode.Uri).fsPath).toBe(path.join(projectDir, "posters", "big-poster", "deck.html"));
    expect(open![2]).toBe(DECK_EDITOR);
  });
});

describe("package.json contributions", () => {
  interface MenuEntry { command: string; when?: string }
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8")) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      views: Record<string, Array<{ id: string; name: string }>>;
      menus: Record<string, MenuEntry[]>;
    };
  };
  const { contributes } = manifest;
  const DECK_COMMANDS = ["labshelf.decks.newTalk", "labshelf.decks.newPoster", "labshelf.decks.present", "labshelf.decks.posterPreview"];
  const DECK_EDITOR_ACTIVE = /activeCustomEditorId\s*==\s*'?labshelf\.deckEditor'?/;

  it("8.2e declares the four deck commands", () => {
    const ids = contributes.commands.map((command) => command.command);
    for (const id of DECK_COMMANDS) { expect(ids).toContain(id); }
  });

  it("8.2e shows the deck commands in the palette only with a writing project open", () => {
    for (const id of DECK_COMMANDS) {
      const entry = contributes.menus.commandPalette!.find((item) => item.command === id);
      expect(entry?.when).toContain("labshelf.writing.projectOpen");
    }
  });

  it("8.2e declares the Talks & Posters view next to the figures view", () => {
    const container = Object.values(contributes.views).find((views) => views.some((view) => view.id === "labshelf.writing.figures"));
    expect(container).toBeDefined();
    expect(container).toContainEqual(expect.objectContaining({ id: "labshelf.writing.decks", name: "Talks & Posters" }));
  });

  it("8.2e adds Present and Poster Preview to the deck editor title bar", () => {
    const editorTitle = contributes.menus["editor/title"]!;
    for (const id of ["labshelf.decks.present", "labshelf.decks.posterPreview"]) {
      const entry = editorTitle.find((item) => item.command === id);
      expect(entry?.when).toMatch(DECK_EDITOR_ACTIVE);
    }
  });
});
