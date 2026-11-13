// The workspace's state object, the parts of its UI that the rest reads, the small helpers every part of the workspace shares, and which
// lines of a talk's or poster's code the workspace shows for the selected unit.
import { findSourceDeckNode, sourceDeckSpanAt, sourceDeckSpans, sourceDeckUnits, type DeckKind, type SourceDeckFormat, type SourceDeckNode, type SourceDeckPath, type SourceDeckRange } from "../../index.js";
import { deriveLineOffsets } from "../../../text/lines.js";
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
  /**
   * The full build a LaTeX file runs by itself to get its page map, once per mount: "wanted" when the first build state the host loaded has
   * no map and no build running or failed, "done" once it ran, any build state followed, or it was not wanted; absent before that first state.
   */
  mapBuild?: "wanted" | "done";
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

/** The spans of the main file's slides (talk) or blocks (poster), as the code shows them one at a time. */
const spansOf = (ws: WorkspaceState): ReturnType<typeof sourceDeckSpans> => sourceDeckSpans(ws.format, ws.text, sourceDeckUnits(ws.kind, ws.tree));

/** The whole line of a main-file section command, as the code shows a section divider. */
function sectionSpan(ws: WorkspaceState, section: PageSection): SourceDeckRange | undefined {
  const starts = deriveLineOffsets(ws.text);
  const from = starts[section.line - 1];
  return from === undefined ? undefined : [from, (starts[section.line] ?? ws.text.length + 1) - 1];
}

/**
 * The lines the code shows and where a cursor outside them goes: the selected section command, the preamble, or the selected slide's or
 * block's span; "elsewhere" when it is in an included file, which opens in its own editor.
 */
function focusTarget(ws: WorkspaceState): { span: SourceDeckRange; at: number } | "elsewhere" | undefined {
  if (ws.section) {
    if (ws.section.file !== undefined) return "elsewhere";
    const span = sectionSpan(ws, ws.section);
    return span && { span, at: span[0] };
  }
  const spans = spansOf(ws);
  const path = unitPath(ws);
  const unit = findSourceDeckNode(ws.tree, path);
  if (!ws.preamble && unit?.file !== undefined) return "elsewhere";
  if (!spans) return undefined;
  if (ws.preamble) return { span: spans.preamble, at: 0 };
  const key = path.join(".");
  const span = spans.units.find((u) => u.path.join(".") === key)?.range;
  return span && { span, at: unit?.range[0] ?? span[0] };
}

/**
 * A talk or poster edited in its code: the editor shows only the selected section's, slide's or block's lines (or the preamble's), and a
 * cursor outside them moves to the unit's start. With File the whole file shows and a pick brings the cursor to the unit. Grid shows the whole file.
 */
export function applyFocus(ws: WorkspaceState): void {
  const { editing } = ws.ports;
  if (!editing.focus) return;
  if (!codeFirst(ws)) { editing.focus(null); return; }
  // The text event of an edit has not arrived yet: the spans would be of the old text, so the next render focuses.
  if (ws.text !== editing.text()) return;
  const target = focusTarget(ws);
  if (target === "elsewhere") return;
  if (!target) { editing.focus(null); return; }
  const { span: [from, to], at } = target;
  if (ws.wholeFile) {
    editing.focus(null);
    const cursor = editing.cursor();
    if (cursor < from || cursor > to) { editing.select(at, at); ws.echo = editing.cursor(); }
    return;
  }
  const before = editing.cursor();
  const after = editing.focus({ from, to }, at);
  if (after !== before) ws.echo = after;
}

/**
 * In a talk's or poster's code, selects the slide or block (or the preamble) whose span holds the editor's offset; a cursor on the selected
 * section command keeps it. False when the file has no unit of its own.
 */
export function selectSpanAt(ws: WorkspaceState, offset: number): boolean {
  const section = ws.section && sectionSpan(ws, ws.section);
  if (section && offset >= section[0] && offset <= section[1]) return true;
  const at = sourceDeckSpanAt(spansOf(ws), offset);
  if (at === undefined) return false;
  ws.section = undefined;
  ws.preamble = at === "preamble";
  if (at !== "preamble") ws.selected = at;
  return true;
}
