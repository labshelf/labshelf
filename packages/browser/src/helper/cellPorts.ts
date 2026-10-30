// The cell runner the browser pages share: one LabShelf Helper connection per page, the Run port the core hosts call and the Python install.
import { formatError, type ICellRunner, type ILogger, type RunCellPort } from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import type { ILatexHelper } from "@labshelf/core/helper";
import { createBrowserLatexHelper } from "./client";

const MODULE = "browser.helper";
const CELL_TIMEOUT_MS = 60_000;
/** A cell with no project runs in the helper's temp folder: `paper:<id>` names that scope. */
const TEMP_SCOPE = "paper:notes";
const NO_HELPER = "LabShelf Helper is not ready. Install it from the extension's settings page, then run the cell again.";

export interface BrowserCellPorts {
  /** Runs a cell in the helper's temp folder. */
  runCell: RunCellPort;
  /** Runs a cell in the folder of the open project `projectId`. */
  runCellIn(projectId: string): RunCellPort;
  /** Installs the helper's Python and says when it is done; a second call while one runs does nothing. */
  installPython(): void;
}

/** The browser's ICellRunner: runs a code cell through LabShelf Helper; aborting the signal makes the helper client post cancelCell. */
export function createHelperCellRunner(helper: ILatexHelper): ICellRunner {
  return {
    run: (request, opts) => helper.runCell({ code: request.code, cwd: opts.cwd, timeoutMs: opts.timeoutMs }, opts.signal),
    // The helper holds no sessions yet; the session manager arrives with the helper's language runners.
    restart: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  };
}

function createCellPorts(createHelper: () => ILatexHelper, logger: ILogger): BrowserCellPorts {
  // The helper connection opens on the first Run or install, so hosts that never run a cell never build it.
  let helper: ILatexHelper | undefined;
  const use = (): ILatexHelper => (helper ??= createHelper());
  const ready = async (): Promise<void> => {
    const state = use().status() ?? await use().connect().catch((error: unknown) => {
      void logger.log("WARN", MODULE, "LabShelf Helper is unreachable for a cell", { error: formatError(error) });
      return undefined;
    });
    if (state?.state !== "ready") { throw new Error(NO_HELPER); }
  };
  const runIn = (cwd: string): RunCellPort => async (request, signal) => {
    await ready();
    return createHelperCellRunner(use()).run(request, { cwd, signal, timeoutMs: CELL_TIMEOUT_MS });
  };
  let installing = false;
  return {
    runCell: runIn(TEMP_SCOPE),
    runCellIn: runIn,
    installPython() {
      if (installing) { return; }
      installing = true;
      void ready().then(() => use().installPython(() => undefined)).then(
        () => showToast("Python is installed. Press Run again on the cell.", "ok"),
        (error: unknown) => {
          void logger.error(MODULE, error, { action: "install python" });
          showToast(`Python could not be installed — ${formatError(error)}`, "error");
        },
      ).finally(() => { installing = false; });
    },
  };
}

let shared: BrowserCellPorts | undefined;

/** @returns the page's cell ports; the helper connects when the first cell runs. */
export function getBrowserCellPorts(logger: ILogger): BrowserCellPorts {
  shared ??= createCellPorts(() => createBrowserLatexHelper(logger), logger);
  return shared;
}
