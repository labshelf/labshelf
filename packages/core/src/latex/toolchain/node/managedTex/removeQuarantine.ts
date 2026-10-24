// Removes the macOS quarantine attribute from a downloaded folder tree so the system lets its binaries run.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ILogger } from "../../../../ports/index.js";

const MODULE = "ClearQuarantine";
const execFileAsync = promisify(execFile);

export type ExecFile = (file: string, args: string[]) => Promise<unknown>;

/**
 * PLATFORM: a helper launched by a browser writes files that inherit com.apple.quarantine; macOS then
 * SIGKILLs the quarantined binaries at exec (exit 137). A failure is logged, not thrown: the tools may still run.
 */
export async function clearQuarantine(dir: string, logger: ILogger, exec: ExecFile = execFileAsync): Promise<void> {
  try {
    await exec("/usr/bin/xattr", ["-dr", "com.apple.quarantine", dir]);
    await logger.log("INFO", MODULE, "Removed the quarantine attribute", { dir });
  } catch (error) {
    // TRAP: xattr exits non-zero with "No such xattr" when nothing is quarantined, the normal case.
    if (String((error as { stderr?: unknown }).stderr ?? error).includes("No such xattr")) { return; }
    await logger.error(MODULE, error, { step: "remove the quarantine attribute", dir });
  }
}
