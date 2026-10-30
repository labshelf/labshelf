// Runs the code cells of reader note editors through the host: one run group per surface, and a Run hook only while the host can run cells.
import type { CellLanguage } from "../../qmd/compute/index.js";
import type { CellResult, CellRunState } from "../../qmd/compute/index.js";
import { createCellRunGroup, type CellRunGroup } from "../../qmd/dom/index.js";
import type { HostBridge } from "./readerSession.js";

/** The editor's `onRunCell` a run group hands out; a preview passes its callback as the fifth argument. */
type CellRunGroupRun = ReturnType<CellRunGroup["attach"]>;

export class ReaderCellRuns {
  private canRun = false;
  private readonly runs = createCellRunGroup({
    onCancel: (requestId) => this.host.post({ command: "cancelCell", requestId }),
    onInstallPython: () => this.host.post({ command: "installPython" }),
  });

  constructor(private readonly host: HostBridge) {}

  /** @returns whether the value changed, so the caller remounts its editors; turning running off drops every status row. */
  setCanRun(canRun: boolean): boolean {
    if (canRun === this.canRun) { return false; }
    this.canRun = canRun;
    if (!canRun) { this.runs.clear(); }
    return true;
  }

  /** Routes a host `cellState`; a request this surface did not send is ignored. */
  show(requestId: string, state: CellRunState): void { this.runs.show(requestId, state); }

  /** Routes a host `cellPreview`; a request this surface did not send is ignored. */
  showPreview(requestId: string, result: CellResult): void { this.runs.showPreview(requestId, result); }

  /** Removes the status row of an item that is gone. */
  drop(itemId: string): void { this.runs.drop(itemId); }

  /** The `onRunCell` and `onRestartCell` options of an editor mounted in `root` for item `itemId`, or none while the host cannot run cells. */
  option(itemId: string, root: HTMLElement): { onRunCell?: CellRunGroupRun; onRestartCell?(language: CellLanguage): void } {
    if (!this.canRun) { return {}; }
    const onRunCell = this.runs.attach(
      itemId, root,
      (label, code, requestId, language, params, preview) => this.host.post({
        command: "runCell", itemId, label, code, language, requestId, ...(params ? { params } : {}), ...(preview ? { preview: true } : {}),
      }),
      (language) => this.host.post({ command: "restartCell", language }),
    );
    const onRestartCell = this.runs.restartCell(itemId);
    return onRestartCell ? { onRunCell, onRestartCell } : { onRunCell };
  }
}
