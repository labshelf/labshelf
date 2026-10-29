// Runs note cells for the VS Code hosts: the Run port the core hosts call, the Python install with progress, and the Run of the editors that store through a note body store.
import * as os from "node:os";
import * as vscode from "vscode";

import { formatError, writeCellOutput, type ICellRunner, type ILogger, type RunCellPort } from "@labshelf/core";
import type { PythonProvider } from "@labshelf/core/node";

const MODULE = "qmd/runCell";
const ENGINE = "python";
const CELL_TIMEOUT_MS = 60_000;
const INSTALL = "Install Python";

/** The body of one note item, read and written back under the item's id. */
interface NoteBodyStore {
  /** The item body, or undefined when the item is gone. */
  read(itemId: string): Promise<string | undefined>;
  write(itemId: string, body: string): Promise<void>;
}

/** @returns the port the core hosts run cells through: the runner with the default timeout, in the temp folder. */
export function createRunCellPort(runner: ICellRunner): RunCellPort {
  return (code, signal) => runner.run(code, { cwd: os.tmpdir(), signal, timeoutMs: CELL_TIMEOUT_MS });
}

/** @returns an installer of the shared Python that shows its progress; a second call while one runs does nothing. Nothing re-runs after it. */
export function createInstallPython(python: PythonProvider, logger: ILogger): () => void {
  let installing = false;
  return () => {
    if (installing) { return; }
    installing = true;
    void installWithProgress(python, logger).finally(() => { installing = false; });
  };
}

async function installWithProgress(python: PythonProvider, logger: ILogger): Promise<void> {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Installing Python for LabShelf cells" }, async (progress) => {
      let reported = 0;
      await python.install((message, fraction) => {
        const done = Math.round((fraction ?? reported / 100) * 100);
        progress.report({ message, increment: Math.max(0, done - reported) });
        reported = Math.max(reported, done);
      });
    });
    void vscode.window.showInformationMessage("Python is installed. Press Run again on the cell.");
  } catch (error) {
    await logger.error(MODULE, error, { step: "install python" });
    void vscode.window.showErrorMessage(`Python could not be installed — ${formatError(error)}`);
  }
}

/**
 * @returns Run for an editor that stores through `store`: runs the cell with a cancellable progress, writes the result
 * after the cell, and offers the install when Python is missing. Cancelled and missing-python runs write nothing.
 */
export function createRunCell(deps: { runner: ICellRunner; python: PythonProvider; store: NoteBodyStore; logger: ILogger }): (itemId: string, label: string, code: string) => Promise<void> {
  const { runner, python, store, logger } = deps;
  const install = createInstallPython(python, logger);
  return async (itemId, label, code) => {
    try {
      if (await store.read(itemId) === undefined) { throw new Error("The note to run a cell of is gone."); }
      const controller = new AbortController();
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Running cell", cancellable: true },
        (_progress, token) => {
          token.onCancellationRequested(() => { controller.abort(); });
          return createRunCellPort(runner)(code, controller.signal);
        },
      );
      if (controller.signal.aborted || result.status === "cancelled") { return; }
      if (result.status === "missing-python") {
        const choice = await vscode.window.showInformationMessage("Running cells needs Python and SymPy, which LabShelf installs once for all its apps.", INSTALL);
        if (choice === INSTALL) { install(); }
        return;
      }
      const body = await store.read(itemId);
      if (body === undefined) { return; }
      const next = await writeCellOutput(body, label, result, { engine: ENGINE, ran: new Date().toISOString() });
      if (next !== body) { await store.write(itemId, next); }
    } catch (error) {
      await logger.error(MODULE, error, { itemId, label });
      void vscode.window.showErrorMessage(`The cell could not run — ${formatError(error)}`);
    }
  };
}
