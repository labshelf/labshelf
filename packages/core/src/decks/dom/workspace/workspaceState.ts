// The workspace's state object, the parts of its UI that the rest reads, and the small helpers every part of the workspace shares.
import { findSourceDeckNode, type DeckKind, type SourceDeckFormat, type SourceDeckNode, type SourceDeckPath } from "../../index.js";
import type { Header, StatusBar } from "./header.js";
import type { Linking } from "./linking.js";
import type { PropertiesPanel } from "./propertiesPanel.js";
import type { Stage } from "./stage.js";
import type { StructurePanel } from "./structurePanel.js";
import type { DeckBuildState, DeckWorkspaceMode, DeckWorkspacePorts } from "./types.js";

/** The workspace's elements and panels, built once by `buildUi`. */
export interface WorkspaceUi {
  root: HTMLElement;
  header: Header;
  insertBar: { element: HTMLElement; refresh(): void };
  structure: StructurePanel;
  actionBar: HTMLElement;
  stage: Stage;
  props: PropertiesPanel;
  notes: HTMLTextAreaElement;
  status: StatusBar;
}

/** Everything one mounted workspace keeps between events; the parts of the workspace are functions over it. */
export interface WorkspaceState {
  ports: DeckWorkspacePorts;
  kind: DeckKind;
  format: SourceDeckFormat;
  name: string;
  text: string;
  tree: SourceDeckNode[];
  selected: SourceDeckPath;
  mode: DeckWorkspaceMode;
  sync: boolean;
  build: DeckBuildState;
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
export const slideIndex = (ws: WorkspaceState): number => (ws.kind === "talk" ? ws.selected[0] ?? 0 : 0);
