// The Talks & Posters tree: the active project's talks and posters by folder name, each opening in the deck editor.
import * as vscode from "vscode";

import { listDecks, type DeckKind } from "@labshelf/core";
import { readActiveProject } from "../build/index.js";
import type { WritingProjects } from "./session.js";

export interface DeckTreeItem { kind: "talk" | "poster"; name: string; uri: vscode.Uri }

/** A group row; with `empty` set it is the one placeholder child of an empty group. */
type DeckGroup = { group: "talk" | "poster"; empty?: true };

export type DeckTreeNode = DeckGroup | DeckTreeItem;

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";
const GROUP_LABEL: Record<DeckKind, string> = { talk: "Talks", poster: "Posters" };
const EMPTY_LABEL: Record<DeckKind, string> = { talk: "No talks yet", poster: "No posters yet" };

const isGroup = (node: DeckTreeNode): node is DeckGroup => "group" in node;

/** The tree data of the Talks & Posters view; `refresh` re-reads the deck folders of the active project. */
export function createDecksTreeProvider(projects: Pick<WritingProjects, "list" | "paths" | "fs">): vscode.TreeDataProvider<DeckTreeNode> & { refresh(): void } {
  const changed = new vscode.EventEmitter<void>();
  const groupItem = (kind: DeckKind): vscode.TreeItem => {
    const item = new vscode.TreeItem(GROUP_LABEL[kind], vscode.TreeItemCollapsibleState.Expanded);
    item.contextValue = "labshelfDeckGroup";
    return item;
  };
  return {
    onDidChangeTreeData: changed.event,
    refresh: () => changed.fire(),
    getTreeItem(node: DeckTreeNode): vscode.TreeItem {
      if (isGroup(node)) return node.empty ? new vscode.TreeItem(EMPTY_LABEL[node.group], vscode.TreeItemCollapsibleState.None) : groupItem(node.group);
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "labshelfDeck";
      item.resourceUri = node.uri;
      item.command = { command: "vscode.openWith", title: "Open Deck", arguments: [node.uri, DECK_EDITOR_VIEW_TYPE] };
      return item;
    },
    async getChildren(parent?: DeckTreeNode): Promise<DeckTreeNode[]> {
      if (!parent) return [{ group: "talk" }, { group: "poster" }];
      if (!isGroup(parent) || parent.empty) return [];
      const project = readActiveProject(projects);
      const decks = project ? await listDecks({ fs: projects.fs, paths: projects.paths }, project.folder) : [];
      const items = decks.filter((deck) => deck.kind === parent.group).map((deck): DeckTreeItem => ({
        kind: deck.kind, name: deck.name, uri: vscode.Uri.file(projects.paths.join(project!.folder, ...deck.file.split("/"))),
      }));
      return items.length > 0 ? items : [{ group: parent.group, empty: true }];
    },
  };
}
