// The generic deck shell's types: the header, status bar, zoom bar, key map and layout every deck editor shares.
import type { IconName, MenuEntry } from "../../../ui/dom/index.js";
import type { DeckKind } from "../../index.js";

/** Grid is the slide grid of compiled talks; a format shows only the modes its header lists. */
export type DeckShellMode = "visual" | "split" | "code" | "grid";

export interface ShellHeaderSpec {
  title: string;
  badge: string;
  modes?: readonly DeckShellMode[];
  onMode?(mode: DeckShellMode): void;
  build?: { run(): void; showProblems(): void };
  saved?: boolean;
  show?: { label: string; icon: IconName; run(): void };
  exports?: ReadonlyArray<{ label: string; icon: IconName; run(): void }>;
}

export interface ShellHeader {
  element: HTMLElement;
  setMode(mode: DeckShellMode): void;
  setBuild(state: { state: "none" | "building" | "succeeded" | "failed"; errors: number }): void;
  setSaved(saved: boolean): void;
}

/** One insert toolbar entry: a button, or a menu built when pressed; `disabled` gives the reason it is off. */
export interface InsertItem { icon: IconName; label: string; run?(): void; menu?(): MenuEntry[]; disabled?(): string | undefined }

export interface ShellStatusParts {
  left: string;
  crumb?: readonly string[];
  hint?: string;
  nav?: { previous(): void; next(): void; canPrevious: boolean; canNext: boolean };
  state?: { tone: "saved" | "dirty" | "problem"; text: string };
}

export interface ShellStatus { element: HTMLElement; set(parts: ShellStatusParts): void }

export type ShellTool = "select" | "hand";

/** What the zoom bar drives: the stage's zoom in percent and its tool. */
export interface ShellZoomSurface {
  percent(): number;
  isFit(): boolean;
  setZoom(next: number | "fit"): void;
  setTool(tool: ShellTool): void;
}

export interface ShellZoomBar {
  element: HTMLElement;
  render(): void;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  tool(): ShellTool;
  setTool(tool: ShellTool): void;
}

/** The shared keys' actions; a key whose action is missing is left to the page. */
export interface ShellKeyActions {
  undo?(): void;
  redo?(): void;
  zoomIn?(): void;
  zoomOut?(): void;
  fit?(): void;
  setTool?(tool: ShellTool): void;
  holdHand?(held: boolean): void;
  previous?(): void;
  next?(): void;
  deleteSelection?(): void;
  clearSelection?(): void;
  duplicate?(): void;
  copy?(): void;
  paste?(): void;
  group?(): void;
  ungroup?(): void;
}

/** The format's elements the shell places. */
export interface DeckShellParts {
  format: "latex" | "typst" | "html";
  kind: DeckKind;
  header: HTMLElement;
  insert: HTMLElement;
  left: HTMLElement;
  stage: HTMLElement;
  zoom: HTMLElement;
  props: HTMLElement;
  status: HTMLElement;
  code?: HTMLElement;
  notes?: HTMLElement;
  /** The slide grid, shown in the stage column in Grid mode. */
  grid?: HTMLElement;
}

export interface DeckShell { root: HTMLElement; setMode(mode: DeckShellMode): void; destroy(): void }
