// The compiled poster's controls in the workspace: the stage's block drag and gap handles over the built page, measured through the
// linking, and the Poster button with Poster Settings in place of the properties. Every edit goes through apply as one undo step.
import {
  moveSourcePosterBlock, readSourcePosterLayout, resizeSourcePosterGap, setSourcePosterSpacing, switchSourcePosterOrientation, type SourceDeckPath,
} from "../../index.js";
import { shellButton } from "../shell/index.js";
import { createSourcePosterSettings, createSourcePosterStage, type SourcePosterStagePort } from "../shell/source/index.js";
import type { Stage } from "./stage.js";
import { apply } from "./workspaceEdits.js";
import type { WorkspaceState } from "./workspaceState.js";

type Columns = NonNullable<ReturnType<SourcePosterStagePort["columns"]>>;
type Place = { column: number; index: number };

export interface WorkspacePoster {
  /** The Poster button of the insert bar. */
  button: HTMLButtonElement;
  /** Measures the blocks again and redraws the stage controls and the open panel. */
  refresh(): void;
  /** A build's PDF was loaded: the page now shows the current text. */
  loaded(): void;
  /** Ends a drag in progress (its window listeners) and closes the panel. */
  destroy(): void;
}

const MM_PER_PT = 25.4 / 72;

/** The poster's columns as tree indexes, each with the tree indexes of its blocks. */
function columnPaths(ws: WorkspaceState): Array<{ tree: number; blocks: number[] }> {
  return ws.tree.flatMap((node, t) => node.kind !== "column" ? [] : [{ tree: t, blocks: (node.children ?? []).flatMap((child, b) => (child.kind === "block" ? [b] : [])) }]);
}

/** The columns of the built page in pt; null when a column or block has no rectangle on page 1. */
async function measure(ws: WorkspaceState): Promise<Columns | null> {
  const { linking, tree } = ws;
  const columns: Columns = [];
  for (const [c, column] of columnPaths(ws).entries()) {
    const blocks: Columns[number]["blocks"] = []; let left = Infinity; let right = -Infinity;
    for (const [b, child] of column.blocks.entries()) {
      const rect = await linking.rectOf([column.tree, child], tree, 1);
      if (!rect || rect.page !== 1) return null;
      left = Math.min(left, rect.left); right = Math.max(right, rect.right);
      blocks.push({ key: `${c}.${b}`, top: rect.top, height: rect.bottom - rect.top });
    }
    if (blocks.length === 0) return null;
    columns.push({ left, width: right - left, blocks });
  }
  return columns.length ? columns : null;
}

/** The tree path of the block at `place` (column and block among the poster's columns and blocks). */
function pathOf(ws: WorkspaceState, place: Place): SourceDeckPath {
  const column = columnPaths(ws)[place.column];
  return column ? [column.tree, ...(column.blocks[place.index] !== undefined ? [column.blocks[place.index]!] : [])] : [];
}

/** The poster controls of a poster workspace over its stage; `style` is the Style button, whose panel and Poster Settings are exclusive. */
export function createWorkspacePoster(ws: WorkspaceState, stage: Stage, style: HTMLButtonElement): WorkspacePoster {
  const text = (): string => ws.ports.editing.text();
  let measured: { columns: Columns | null; tree: unknown } = { columns: null, tree: undefined };
  let builtText: string | undefined;
  let ticket = 0;
  const fresh = (): boolean => ws.build.state !== "building" && ws.build.state !== "failed" && builtText === ws.text && stage.pdf() !== undefined;

  const controls = createSourcePosterStage({
    columns: () => (fresh() && measured.tree === ws.tree ? measured.columns : null),
    scale: () => stage.scale(),
    enabled: () => stage.element.dataset["tool"] !== "hand",
    move: (from, to) => { apply(ws, moveSourcePosterBlock(ws.format, text(), from, to), () => pathOf(ws, to)); },
    resize: (gap, deltaPt) => { apply(ws, resizeSourcePosterGap(ws.format, text(), gap, deltaPt * MM_PER_PT)); },
    suppressClick: () => stage.suppressClick(),
  });
  stage.addLayer(controls.element);
  const drawControls = (): void => {
    controls.render();
    const ratios = readSourcePosterLayout(ws.format, ws.text)?.ratios ?? null;
    if (!ratios) for (const handle of controls.element.querySelectorAll<HTMLElement>(".dsh-poster-gap")) handle.hidden = true;
  };

  const settings = createSourcePosterSettings({
    layout: () => readSourcePosterLayout(ws.format, text()),
    spacing: (change) => { apply(ws, setSourcePosterSpacing(ws.format, text(), change)); },
    orientation: () => { if (apply(ws, switchSourcePosterOrientation(ws.format, text()))) ws.posterTurned = true; },
  });
  let open = false;
  const props = (): HTMLElement => ws.ui.props.element;
  const close = (restoreProps: boolean): void => {
    if (!open) return;
    open = false;
    settings.element.remove();
    if (restoreProps) props().hidden = false;
    button.setAttribute("aria-pressed", "false");
  };
  const button = shellButton("layers", "Poster", "dw-insert", () => {
    if (open) return close(true);
    // Style's panel closes first, so the properties come back before Poster Settings takes their place.
    if (style.getAttribute("aria-pressed") === "true") style.click();
    open = true;
    settings.render();
    props().after(settings.element);
    props().hidden = true;
    button.setAttribute("aria-pressed", "true");
  });
  button.setAttribute("aria-pressed", "false");
  style.addEventListener("click", () => { if (style.getAttribute("aria-pressed") === "true") close(false); });

  const refresh = (): void => {
    drawControls();
    if (open) settings.render();
    const own = ++ticket;
    const tree = ws.tree;
    void measure(ws).then((columns) => {
      if (own !== ticket) return;
      measured = { columns, tree };
      drawControls();
    }, () => undefined);
  };

  return {
    button,
    refresh,
    loaded() { builtText = ws.text; refresh(); },
    destroy() { ticket++; controls.destroy(); close(false); },
  };
}
