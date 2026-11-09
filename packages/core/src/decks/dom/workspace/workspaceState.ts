// The workspace's state object, the parts of its UI that the rest reads, and the small helpers every part of the workspace shares.
import { findSourceDeckNode, sourceDeckUnits, type DeckKind, type SourceDeckFormat, type SourceDeckNode, type SourceDeckPath } from "../../index.js";
import type { DeckShell, ShellHeader, ShellStatus } from "../shell/index.js";
import type { Linking, PageSection } from "./linking.js";
import type { PropertiesPanel } from "./propertiesPanel.js";
import type { Stage } from "./stage.js";
import type { WorkspacePoster } from "./workspaceStyle.js";
import type { StructurePanel } from "./structurePanel.js";
import type { DeckBuildState, DeckWorkspaceMode, DeckWorkspacePorts } from "./types.js";

/** The workspace's elements and panels, built once by `buildUi` and placed by the shell. */
export interface WorkspaceUi {
  root: HTMLElement;
  shell: DeckShell;
  /** Stops the shell's keys on the root. */
  unbindKeys(): void;
  header: ShellHeader;
  insertBar: { element: HTMLElement; refresh(): void };
  /** A talk's slide strip; a poster has none. */
  structure?: StructurePanel;
  stage: Stage;
  /** A poster's Poster Settings; absent for a talk. */
  poster?: WorkspacePoster;
  props: PropertiesPanel;
  notes: HTMLTextAreaElement;
  status: ShellStatus;
}

/** Everything one mounted workspace keeps between events; the parts of the workspace are functions over it. */
export interface WorkspaceState {
  ports: DeckWorkspacePorts;
  kind: DeckKind;
  format: SourceDeckFormat;
  name: string;
  text: string;
  /** The text of each included file read so far, by project-relative path; a path that could not be read maps to undefined. */
  files: Map<string, string | undefined>;
  tree: SourceDeckNode[];
  selected: SourceDeckPath;
  /** The code shows the preamble instead of the selected slide or block; `selected` keeps the one to go back to. */
  preamble: boolean;
  /** A talk's code shows this section command (a divider page the build shipped) instead of the selected slide. */
  section: PageSection | undefined;
  /** The code shows the whole file instead of the selected slide's or block's lines. */
  wholeFile: boolean;
  /** A talk's Split shows the slide grid in the preview's window instead of the page (the Grid button); `mode` stays "split". */
  gridShown: boolean;
  mode: DeckWorkspaceMode;
  sync: boolean;
  /** The cursor the workspace's own select or reveal left in the editor: the cursor event that echoes it is not a move of the user's. */
  echo: number | undefined;
  build: DeckBuildState;
  /** The tree indexes of the talk slides the last loaded build marks as overflowing; absent before one. */
  overflow?: Set<number>;
  /** The "column.block" keys of the poster blocks the last loaded build marks as overflowing; absent before one. */
  posterOverflow?: Set<string>;
  /** An orientation switch was written and no build has finished since: that build warns when it overflows. */
  posterTurned?: boolean;
  /** The status warning after an orientation switch whose build overflowed, until the next build. */
  posterWarning?: string | undefined;
  ownEdit: boolean;
  linking: Linking;
  buildSoon: { call(): void; cancel(): void };
  flashTimer: ReturnType<typeof setTimeout> | undefined;
  ui: WorkspaceUi;
}

export const debounce = (ms: number, run: () => void): { call(): void; cancel(): void } => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return { call: () => { clearTimeout(timer); timer = setTimeout(run, ms); }, cancel: () => clearTimeout(timer) };
};

export const selectedNode = (ws: WorkspaceState): SourceDeckNode | undefined => findSourceDeckNode(ws.tree, ws.selected);
/**
 * A talk or poster edited in its code, with the preview (Split) or without it (Code): the code shows one slide or poster block (or the
 * preamble) at a time, unless the whole file is asked for, and the selection is the slide or block, never an element.
 */
export const codeFirst = (ws: WorkspaceState): boolean => ws.mode === "split" || ws.mode === "code";
/** The selected slide (talk) or block (poster, the block holding a selected element) as the code shows it; a poster's first block when none is. */
export const unitPath = (ws: WorkspaceState): SourceDeckPath =>
  ws.kind === "talk" ? [slideIndex(ws)] : ws.selected.length >= 2 ? ws.selected.slice(0, 2) : sourceDeckUnits("poster", ws.tree)[0]?.path ?? [];
export const slideIndex = (ws: WorkspaceState): number => (ws.kind === "talk" ? ws.selected[0] ?? 0 : 0);
