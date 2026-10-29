// Runs and cancels code cells for the page: runCell answers cellResult under the request id, and cancelCell aborts a run by that id.
// CONTRACT: documents/contracts/helper.md#messages
import type { ILogger } from "../../ports/index.js";
import type { ICellRunner } from "../../qmd/compute/cellRunner.js";
import { PROTOCOL_VERSION } from "../helperMessages.js";
import type { HelperHandler } from "./helperHandlers.js";

const MODULE = "helper-cells";

export interface CellHandlersOptions {
  runner: ICellRunner;
  /** The folder a cwd scope (a project id or `paper:<id>`) names, or undefined for one the helper does not know. */
  resolveCwd(scope: string): string | undefined;
  logger: ILogger;
}

export function createCellHandlers(options: CellHandlersOptions): { runCell: HelperHandler; cancelCell: HelperHandler } {
  const { runner, resolveCwd, logger } = options;
  const running = new Map<string, AbortController>();

  // INVARIANT: the controller is registered before any await, because the dispatcher runs a `cancelCell` without waiting for this run.
  const runCell: HelperHandler = async (message, send) => {
    if (message.type !== "runCell") { throw new Error(`runCell handler received ${message.type}`); }
    const { id } = message;
    const cwd = resolveCwd(message.cwd);
    if (cwd === undefined) {
      void logger.log("WARN", MODULE, "Cell refused: unknown cwd scope", { id, scope: message.cwd });
      send({ v: PROTOCOL_VERSION, id, type: "error", code: "project-id", message: `cwd "${message.cwd}" is not a project that is open or a known paper` });
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const result = await runner.run(message.code, { cwd, signal: controller.signal, timeoutMs: message.timeoutMs });
      send({ v: PROTOCOL_VERSION, id, type: "cellResult", ...result });
    } finally {
      running.delete(id);
    }
  };

  const cancelCell: HelperHandler = (message) => {
    if (message.type !== "cancelCell") { throw new Error(`cancelCell handler received ${message.type}`); }
    const controller = running.get(message.requestId);
    void logger.log("INFO", MODULE, controller ? "Cancelling the running cell" : "Cancel with no running cell", { requestId: message.requestId });
    controller?.abort();
    return Promise.resolve();
  };

  return { runCell, cancelCell };
}
