// The Talks & Posters tree of the open project, shown in the Library sidebar beside Files, Outline and Checklist: visual (HTML) decks and
// LaTeX or Typst talks and posters, each source one with its slides or blocks, and the slide commands (move, duplicate, delete) on the source.
import * as vscode from "vscode";

import {
  deleteSourceSlide, duplicateSourceSlide, listDecks, listSourceDecks, moveSourceSlide, readSourceDeckOutline,
  type DeckKind, type ILogger, type SourceDeckFormat, type SourceDeckItem,
} from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { readActiveProject } from "../build/index.js";
import type { ProjectTreeSpec } from "./mirror.js";
import type { ProjectSession, WritingProjects } from "./session.js";

/** One talk or poster: a visual deck (deck.html, `format` absent) or a LaTeX or Typst source. `uri` is the deck.html or the source file. */
interface DeckRow { kind: DeckKind; name: string; uri: vscode.Uri; format?: SourceDeckFormat }

/** A deck row, or one slide (talk) or block (poster) of a source deck. */
export type DeckTreeNode = { deck: DeckRow; uri: vscode.Uri } | { deck: DeckRow; uri: vscode.Uri; index: number; item: SourceDeckItem };

const isItem = (node: DeckTreeNode): node is Extract<DeckTreeNode, { index: number }> => "index" in node;

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";
const NOUN: Record<DeckKind, string> = { talk: "Talk", poster: "Poster" };
const FORMAT_LABEL: Record<SourceDeckFormat, string> = { latex: "LaTeX", typst: "Typst" };
const REVEAL = "labshelf.decks.revealItem";
const MOVE_UP = "labshelf.decks.moveSlideUp";
const MOVE_DOWN = "labshelf.decks.moveSlideDown";
const DUPLICATE = "labshelf.decks.duplicateSlide";
const DELETE = "labshelf.decks.deleteSlide";

/** The text of a file: an open document's (with unsaved edits) or the disk's. */
async function readText(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
  return open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

/**
 * The tree data of Talks & Posters: the open project's decks (else the focused file's project), visual ones first by kind and name, each
 * source deck folding open on its slides or blocks. `refresh` re-reads them.
 */
export function createDecksTreeProvider(projects: Pick<WritingProjects, "list" | "paths" | "fs">, session?: Pick<ProjectSession, "project">): vscode.TreeDataProvider<DeckTreeNode> & { refresh(): void } {
  const changed = new vscode.EventEmitter<void>();
  const rows = async (): Promise<DeckRow[]> => {
    const project = session?.project ?? readActiveProject(projects);
    if (!project) return [];
    const at = (file: string): vscode.Uri => vscode.Uri.file(projects.paths.join(project.folder, ...file.split("/")));
    const visual = (await listDecks({ fs: projects.fs, paths: projects.paths }, project.folder)).map((deck): DeckRow => ({ kind: deck.kind, name: deck.name, uri: at(deck.file) }));
    const format: SourceDeckFormat = project.settings.format === "typst" ? "typst" : "latex";
    const source = (await listSourceDecks({ fs: projects.fs, paths: projects.paths }, project.folder, { main: project.main ?? "", format })).map((deck): DeckRow => ({ kind: deck.kind, name: deck.name, uri: at(deck.file), format }));
    return [...visual, ...source].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "talk" ? -1 : 1));
  };
  return {
    onDidChangeTreeData: changed.event,
    refresh: () => changed.fire(),
    getTreeItem(node: DeckTreeNode): vscode.TreeItem {
      const { deck } = node;
      if (isItem(node)) {
        const item = new vscode.TreeItem(node.item.title, vscode.TreeItemCollapsibleState.None);
        item.id = `${deck.uri.toString()}#${node.index}`;
        if (deck.kind === "talk") item.description = String(node.index + 1);
        item.tooltip = `Line ${node.item.line}`;
        item.contextValue = deck.kind === "talk" ? "labshelfDeckSlide" : "labshelfDeckBlock";
        item.command = { command: REVEAL, title: "Show in source", arguments: [node] };
        return item;
      }
      const item = new vscode.TreeItem(deck.name, deck.format ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = deck.uri.toString();
      item.description = `${NOUN[deck.kind]} · ${deck.format ? FORMAT_LABEL[deck.format] : "Visual"}`;
      item.resourceUri = deck.uri;
      item.contextValue = deck.kind === "talk" ? "labshelfDeckTalk" : "labshelfDeckPoster";
      item.command = deck.format
        ? { command: "vscode.open", title: "Open Source", arguments: [deck.uri] }
        : { command: "vscode.openWith", title: "Open Deck", arguments: [deck.uri, DECK_EDITOR_VIEW_TYPE] };
      return item;
    },
    async getChildren(parent?: DeckTreeNode): Promise<DeckTreeNode[]> {
      if (!parent) return (await rows()).map((deck) => ({ deck, uri: deck.uri }));
      if (isItem(parent) || !parent.deck.format) return [];
      const { deck } = parent;
      const items = readSourceDeckOutline(deck.format!, deck.kind, await readText(deck.uri).catch(() => ""));
      return items.map((item, index) => ({ deck, uri: deck.uri, index, item }));
    },
  };
}

/** Opens a source deck at the line of a slide or block. */
async function revealItem(node: DeckTreeNode): Promise<void> {
  if (!isItem(node)) return;
  const position = new vscode.Position(Math.max(0, node.item.line - 1), 0);
  await vscode.window.showTextDocument(node.deck.uri, { selection: new vscode.Range(position, position) });
}

type SlideEdit = (text: string, slides: readonly SourceDeckItem[], index: number) => string | null;

/** Applies a slide edit to the source as one undoable edit of the whole document, saved. The slides are re-read from the current text. */
async function editSlides(node: DeckTreeNode, edit: SlideEdit): Promise<void> {
  if (!isItem(node) || !node.deck.format || node.deck.kind !== "talk") return;
  const document = await vscode.workspace.openTextDocument(node.deck.uri);
  const text = document.getText();
  const next = edit(text, readSourceDeckOutline(node.deck.format, "talk", text), node.index);
  if (next === null || next === text) return;
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), next);
  if (await vscode.workspace.applyEdit(workspaceEdit)) await document.save();
}

async function deleteSlide(node: DeckTreeNode): Promise<void> {
  if (!isItem(node)) return;
  const answer = await vscode.window.showWarningMessage(`Delete the slide "${node.item.title}"?`, { modal: true }, "Delete");
  if (answer === "Delete") await editSlides(node, deleteSourceSlide);
}

/** Registers the slide commands of the Talks & Posters rows; `refresh` re-reads the tree after an edit. */
export function registerDeckSlideCommands(context: vscode.ExtensionContext, logger: ILogger, refresh: () => void): void {
  const safely = (id: string, action: (node: DeckTreeNode) => Promise<void>) => (node: DeckTreeNode): Promise<void> =>
    runSafely(logger, id, async () => { await action(node); refresh(); });
  context.subscriptions.push(
    vscode.commands.registerCommand(REVEAL, (node: DeckTreeNode) => runSafely(logger, REVEAL, () => revealItem(node))),
    vscode.commands.registerCommand(MOVE_UP, safely(MOVE_UP, (node) => editSlides(node, (text, slides, index) => moveSourceSlide(text, slides, index, -1)))),
    vscode.commands.registerCommand(MOVE_DOWN, safely(MOVE_DOWN, (node) => editSlides(node, (text, slides, index) => moveSourceSlide(text, slides, index, 1)))),
    vscode.commands.registerCommand(DUPLICATE, safely(DUPLICATE, (node) => editSlides(node, duplicateSourceSlide))),
    vscode.commands.registerCommand(DELETE, safely(DELETE, deleteSlide)),
  );
}

/** The Talks & Posters tree as the sidebar mirrors it: a + action that asks what to make, and the row menus. */
export function decksSpec(provider: vscode.TreeDataProvider<DeckTreeNode>): ProjectTreeSpec<DeckTreeNode> {
  const present = { label: "Present", action: "present", command: "labshelf.decks.present" };
  const posterPreview = { label: "Poster Preview", action: "posterPreview", command: "labshelf.decks.posterPreview" };
  return {
    view: "decks", title: "Talks & Posters", provider, empty: "No talks or posters yet. Use + to make one.",
    actions: [{ action: "newDeck", label: "New talk or poster", icon: "plus", run: () => vscode.commands.executeCommand("labshelf.decks.new") }],
    menus: {
      labshelfDeckTalk: [present],
      labshelfDeckPoster: [posterPreview],
      labshelfDeckSlide: [
        { label: "Move Up", action: "moveSlideUp", command: MOVE_UP },
        { label: "Move Down", action: "moveSlideDown", command: MOVE_DOWN },
        { label: "Duplicate", action: "duplicateSlide", command: DUPLICATE },
        { label: "Delete", action: "deleteSlide", danger: true, command: DELETE },
      ],
    },
  };
}
