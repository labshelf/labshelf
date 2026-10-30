// Runs the Python cells of reader note editors through the host: one run group per surface, and a Run hook only while the host can run cells.
import type { CellRunState } from "../../qmd/compute/index.js";
import { createCellRunGroup } from "../../qmd/dom/index.js";
import type { HostBridge } from "./readerSession.js";

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

  /** Removes the status row of an item that is gone. */
  drop(itemId: string): void { this.runs.drop(itemId); }

  /** The `onRunCell` option of an editor mounted in `root` for item `itemId`, or none while the host cannot run cells. */
  option(itemId: string, root: HTMLElement): { onRunCell?(label: string, code: string): void } {
    if (!this.canRun) { return {}; }
    return { onRunCell: this.runs.attach(itemId, root, (label, code, requestId) => this.host.post({ command: "runCell", itemId, label, code, requestId })) };
  }
}
