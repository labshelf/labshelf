// The browser's ICellRunner: runs a code cell through LabShelf Helper; aborting the signal makes the helper client post cancelCell.
import type { ILatexHelper } from "@labshelf/core/helper";
import type { ICellRunner } from "@labshelf/core";

export function createHelperCellRunner(helper: ILatexHelper): ICellRunner {
  return { run: (code, opts) => helper.runCell({ code, cwd: opts.cwd, timeoutMs: opts.timeoutMs }, opts.signal) };
}
