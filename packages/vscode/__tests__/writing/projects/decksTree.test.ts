// The Talks & Posters tree of the open project: visual and source decks, source slides as children, and the slide commands.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { createDecksTreeProvider, decksSpec, registerDeckSlideCommands, type DeckTreeNode } from "../../../src/writing/projects/decksTree";
import { commandHandler, fakeLogger, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

const BEAMER = "\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{One}\nA\n\\end{frame}\n\\begin{frame}{Two}\nB\n\\end{frame}\n\\end{document}\n";

type DecksProvider = vscode.TreeDataProvider<DeckTreeNode> & { refresh(): void };

const labelOf = (item: vscode.TreeItem): string => (typeof item.label === "string" ? item.label : item.label?.label ?? "");

function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

describe("createDecksTreeProvider", () => {
  let projectDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => fs.readFileSync(uri.fsPath));
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-decks-tree-")));
    write(projectDir, "main.tex", "\\documentclass{article}");
  });

  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  const makeProvider = (open = true): DecksProvider => {
    const project = readyEntry(projectDir) as never;
    return createDecksTreeProvider(fakeProjects([project]) as never, { project: open ? project : undefined }) as DecksProvider;
  };

  async function rows(provider: DecksProvider): Promise<Array<{ label: string; description: string }>> {
    const nodes = (await provider.getChildren()) ?? [];
    return Promise.all(nodes.map(async (node) => {
      const item = await provider.getTreeItem(node);
      return { label: labelOf(item), description: String(item.description ?? "") };
    }));
  }

  it("lists visual and LaTeX decks of the open project, talks first, each with its kind and format", async () => {
    write(projectDir, "talks/visual/deck.html", "<html></html>");
    write(projectDir, "talks/defense/main.tex", BEAMER);
    write(projectDir, "posters/a0/main.tex", "\\documentclass{tikzposter}\n\\block{Intro}{x}");
    expect(await rows(makeProvider())).toEqual([
      { label: "defense", description: "Talk · LaTeX" },
      { label: "visual", description: "Talk · Visual" },
      { label: "a0", description: "Poster · LaTeX" },
    ]);
  });

  it("lists the decks of the focused file's project when no project is open", async () => {
    write(projectDir, "talks/defense/main.tex", BEAMER);
    openInEditor(path.join(projectDir, "main.tex"));
    expect((await rows(makeProvider(false))).map((row) => row.label)).toEqual(["defense"]);
  });

  it("opens a visual deck in the deck editor and a source deck as text", async () => {
    write(projectDir, "talks/visual/deck.html", "<html></html>");
    write(projectDir, "talks/defense/main.tex", BEAMER);
    const provider = makeProvider();
    const [source, visual] = (await provider.getChildren()) ?? [];
    expect((await provider.getTreeItem(visual!)).command?.arguments?.[1]).toBe("labshelf.deckEditor");
    expect((await provider.getTreeItem(source!)).command?.command).toBe("vscode.open");
  });

  it("folds a source talk open on its slides, each revealing its line", async () => {
    write(projectDir, "talks/defense/main.tex", BEAMER);
    const provider = makeProvider();
    const [deck] = (await provider.getChildren()) ?? [];
    const slides = (await provider.getChildren(deck)) ?? [];
    const items = await Promise.all(slides.map((slide) => provider.getTreeItem(slide)));
    expect(items.map(labelOf)).toEqual(["One", "Two"]);
    expect(items[1]!.contextValue).toBe("labshelfDeckSlide");
    expect(items[1]!.command?.command).toBe("labshelf.decks.revealItem");
  });

  it("offers + and the slide menus to the sidebar mirror", () => {
    const spec = decksSpec(makeProvider());
    expect(spec.view).toBe("decks");
    expect(spec.actions.map((action) => action.action)).toEqual(["newDeck"]);
    expect("menus" in spec && spec.menus["labshelfDeckSlide"]!.map((entry) => entry.action)).toEqual(["moveSlideUp", "moveSlideDown", "duplicateSlide", "deleteSlide"]);
  });
});

describe("registerDeckSlideCommands", () => {
  beforeEach(() => jest.clearAllMocks());

  function fakeDocument(uri: vscode.Uri, text: string) {
    return { uri, getText: () => text, positionAt: (offset: number) => new vscode.Position(0, offset), save: jest.fn(async () => true) };
  }

  it("moves a slide down as one edit of the whole source, then saves and refreshes", async () => {
    const uri = vscode.Uri.file("/p/talks/defense/main.tex");
    const document = fakeDocument(uri, BEAMER);
    (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValueOnce(document);
    const refresh = jest.fn();
    registerDeckSlideCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext, fakeLogger(), refresh);
    const deck = { kind: "talk" as const, name: "defense", uri, format: "latex" as const };
    await commandHandler("labshelf.decks.moveSlideDown")({ deck, uri, index: 0, item: { title: "One", line: 3, start: 0, end: 0 } });
    const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0]![0] as { replacements: Array<{ text: string }> };
    const text = edit.replacements[0]!.text;
    expect(text.indexOf("{Two}")).toBeLessThan(text.indexOf("{One}"));
    expect(document.save).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});
