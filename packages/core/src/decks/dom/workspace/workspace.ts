// The talk and poster workspace around a LaTeX or Typst source editor: Split (the code of one slide or block beside the page, linked
// both ways), Code (the editor alone) and a talk's Grid. Every edit it makes goes through the editor as one undo step, and 800 ms after
// the last one it saves and builds, keeping the selection by node path.
import { readSourceDeckBlocks, type DeckKind, type SourceDeckFormat } from "../../index.js";
import { readDeckKindOf } from "../../../writing/dom/sourceEditor/index.js";
import { createLinking } from "./linking.js";
import type { DeckWorkspace, DeckWorkspacePorts } from "./types.js";
import { debounce, type WorkspaceState, type WorkspaceUi } from "./workspaceState.js";
import { buildUi } from "./workspaceUi.js";
import { attachCursor, buildStateChanged, cursorMoved, fileCursorMoved, loadFirst, setMode, textChanged } from "./workspaceView.js";

const BUILD_DELAY_MS = 800;
const CURSOR_DELAY_MS = 120;
const TEXT_DELAY_MS = 150;

/** The state of a workspace over a file of `kind`; `ui` is filled by `buildUi`, whose callbacks need the state. */
function createState(ports: DeckWorkspacePorts, kind: DeckKind): WorkspaceState {
  const { editing } = ports;
  const format: SourceDeckFormat = ports.path.endsWith(".typ") ? "typst" : "latex";
  const text = editing.text();
  const tree = readSourceDeckBlocks(format, kind, text);
  return {
    ports, kind, format, text, files: new Map(), tree, selected: [], preamble: false, section: undefined, wholeFile: false, gridShown: false, sync: true, echo: undefined, build: { state: "none", errors: 0 }, ownEdit: false, flashTimer: undefined,
    name: ports.path.split("/").slice(-2, -1)[0] ?? ports.path,
    // Neither has a Visual mode: a stored one opens Split.
    mode: ports.mode.read() === "visual" ? "split" : ports.mode.read() ?? "split",
    linking: createLinking(kind, ports.path),
    buildSoon: debounce(BUILD_DELAY_MS, () => ports.build.run()),
    ui: {} as WorkspaceUi,
  };
}

/** Mounts the workspace in `host` around the source editor of a talk or poster; undefined when the file is neither. */
export function mountDeckWorkspace(host: HTMLElement, ports: DeckWorkspacePorts): DeckWorkspace | undefined {
  const kind: DeckKind | undefined = readDeckKindOf(ports.path, ports.editing.text());
  if (!kind) return undefined;
  const ws = createState(ports, kind);
  Object.assign(ws.ui, buildUi(ws, host));

  const onText = debounce(TEXT_DELAY_MS, () => textChanged(ws));
  const cursorSoon = { offset: 0, timer: debounce(CURSOR_DELAY_MS, () => cursorMoved(ws, cursorSoon.offset)) };
  const unsubscribe = ports.subscribe({
    text: () => onText.call(),
    cursor: (offset) => { cursorSoon.offset = offset; cursorSoon.timer.call(); },
  });
  attachCursor(ws, () => cursorSoon.timer.cancel());
  const stopFileCursor = ports.files?.onCursor?.((path, line) => fileCursorMoved(ws, path, line)) ?? ((): void => undefined);
  const stopBuild = ports.build.onState((next) => buildStateChanged(ws, next));

  setMode(ws, ws.mode);
  loadFirst(ws);

  return {
    mode: () => (ws.gridShown ? "grid" : ws.mode),
    setMode: (next) => setMode(ws, next),
    dispose() {
      unsubscribe(); stopFileCursor(); stopBuild(); ws.buildSoon.cancel(); onText.cancel(); cursorSoon.timer.cancel(); ws.ui.unbindKeys(); ws.ui.stage.dispose();
      ws.ui.shell.destroy();
    },
  };
}
