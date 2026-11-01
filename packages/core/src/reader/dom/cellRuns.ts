// Runs the code cells of reader note editors through the host: one run group per surface, and a Run hook only while the host can run cells.
import type { CellLanguage } from "../../qmd/compute/index.js";
import type { CellResult, CellRunState } from "../../qmd/compute/index.js";
import type { MathResult } from "../../qmd/compute/index.js";
import type { Annotation } from "../../model/index.js";
import { parseAnchor } from "../../qmd/item/index.js";
import { createCellRunGroup, createCellsAbove, createEvalMathBridge, type CellRunGroup, type CellsAbove, type OnEvalMath } from "../../qmd/dom/index.js";
import type { ReaderNote } from "../protocol/index.js";
import type { HostBridge } from "./readerSession.js";

/** The page a note sits on (null when unanchored or its highlight is gone). */
function notePage(note: ReaderNote, annotations: ReadonlyMap<string, Annotation>): number | null {
  const anchor = parseAnchor(note.anchor);
  if (anchor.kind === "highlight") { return annotations.get(anchor.annotationId)?.pageNumber ?? null; }
  return anchor.kind === "point" || anchor.kind === "box" ? anchor.page : null;
}

/** The one note order of the reader: by page (notes without one last), then creation, then id. Both surfaces pass it to `listBodiesBefore` so a result's source hash agrees. */
export function compareNotesByPlace(annotations: ReadonlyMap<string, Annotation>): (a: ReaderNote, b: ReaderNote) => number {
  return (a, b) => (notePage(a, annotations) ?? Infinity) - (notePage(b, annotations) ?? Infinity) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id);
}

/** The bodies (drafts where there are any) of the notes that come before note `id` in `order`. */
export function listBodiesBefore(notes: readonly ReaderNote[], drafts: ReadonlyMap<string, string>, id: string, order: (a: ReaderNote, b: ReaderNote) => number): string[] {
  const ordered = [...notes].sort(order);
  const at = ordered.findIndex((note) => note.id === id);
  return ordered.slice(0, Math.max(at, 0)).map((note) => drafts.get(note.id) ?? note.body);
}

/** The editor's `onRunCell` a run group hands out; a preview passes its callback as the fifth argument. */
type CellRunGroupRun = ReturnType<CellRunGroup["attach"]>;

export class ReaderCellRuns {
  private canRun = false;
  private readonly runs = createCellRunGroup({
    onCancel: (requestId) => this.host.post({ command: "cancelCell", requestId }),
    onInstallPython: () => this.host.post({ command: "installPython" }),
  });

  /** Prose math requests, kept apart from the cell runs: their replies are `mathResult`, not `cellState` or `cellPreview`. */
  private readonly math = createEvalMathBridge();

  constructor(private readonly host: HostBridge) {}

  /** @returns whether the value changed, so the caller remounts its editors; turning running off drops every status row. */
  setCanRun(canRun: boolean): boolean {
    if (canRun === this.canRun) { return false; }
    this.canRun = canRun;
    if (!canRun) { this.runs.clear(); this.math.clear(); }
    return true;
  }

  /** Routes a host `cellState`; a request this surface did not send is ignored. */
  show(requestId: string, state: CellRunState): void { this.runs.show(requestId, state); }

  /** Routes a host `cellPreview`; a request this surface did not send is ignored. */
  showPreview(requestId: string, result: CellResult): void { this.runs.showPreview(requestId, result); }

  /** Routes a host `mathResult`; a request this surface did not send is ignored. */
  showMathResult(requestId: string, result: MathResult): void { this.math.receive(requestId, result); }

  /** Removes the status row of an item that is gone. */
  drop(itemId: string): void { this.runs.drop(itemId); }

  /**
   * The `onRunCell` and `onRestartCell` options of an editor mounted in `root` for item `itemId`, or none while the host cannot run cells.
   * With `cells` (the bodies of the items listed before this one and this item's latest body) it also gives `onEvalMath` and `cellsAbove`.
   */
  option(itemId: string, root: HTMLElement, cells?: { earlier(): readonly string[]; own(): string }):
    { onRunCell?: CellRunGroupRun; onRestartCell?(language: CellLanguage): void; onEvalMath?: OnEvalMath; cellsAbove?: CellsAbove } {
    if (!this.canRun) { return {}; }
    const evalMath = cells ? {
      onEvalMath: this.math.forEditor((requestId, request) => this.host.post({ command: "evalMath", requestId, itemId, op: request.op, tex: request.tex })),
      cellsAbove: createCellsAbove(cells.earlier, cells.own),
    } : {};
    const onRunCell = this.runs.attach(
      itemId, root,
      (label, code, requestId, language, params, preview) => this.host.post({
        command: "runCell", itemId, label, code, language, requestId, ...(params ? { params } : {}), ...(preview ? { preview: true } : {}),
      }),
      (language) => this.host.post({ command: "restartCell", language }),
    );
    const onRestartCell = this.runs.restartCell(itemId);
    return onRestartCell ? { onRunCell, onRestartCell, ...evalMath } : { onRunCell, ...evalMath };
  }
}
