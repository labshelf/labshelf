// The deck workspace's options, its controller and the context its parts share: the bare editor, its last view and the host's hooks.
import type { DeckEditResult } from "../../../deckEdit.js";
import type { DeckEditorController, DeckEditorOptions, DeckEditorView } from "../../deckEditorCore.js";

/** The host's commands behind the header buttons; an absent one hides its button or menu entry. */
export interface DeckWorkspaceCommands { present?(): void; preview?(): void; exportPdf?(): void; exportHtml?(): void; shareLink?(): void }

export interface DeckWorkspaceOptions extends Omit<DeckEditorOptions, "onRender"> {
  /** The deck's name in the header. */
  title: string;
  commands?: DeckWorkspaceCommands;
  /** Picks an image for a new or replaced image block; the path is relative to the deck. Absent, Image is off. */
  pickImage?(): Promise<string | undefined>;
}

export interface DeckWorkspaceController extends DeckEditorController {
  /** Shows whether the host has saved the last change. */
  setSaved(saved: boolean): void;
}

/** What the workspace's parts share. */
export interface ShellContext {
  readonly options: DeckWorkspaceOptions;
  editor: DeckEditorController;
  view: DeckEditorView;
  /** One undo step of edits; `select` names the blocks to select after it. */
  edit(steps: Array<(html: string) => DeckEditResult>, label: string, select?: readonly string[]): void;
}

export type BlockInsertKind = "text" | "image" | "equation" | "rect" | "ellipse" | "line";
