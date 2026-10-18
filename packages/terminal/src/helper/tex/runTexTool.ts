// Runs a TeX tool (tlmgr, install-tl) to its end, logging it and reporting its progress counter.
import type { ILogger } from "@labshelf/core";
import { runCancellable } from "@labshelf/core/node";

export const TEX_MODULE = "helper.tex";

export interface TexToolRun {
  executable: string;
  args: string[];
  cwd: string;
  logger: ILogger;
  /** Receives the fraction (0..1) of the latest `[n/total, …]` line. */
  onProgress?: ((fraction: number) => void) | undefined;
}

export interface TexToolOutcome {
  code: number | null;
  /** The tail of stdout and stderr, interleaved. */
  output: string;
}

const PROGRESS = /\[(\d+)\/(\d+),/g;

/** The fraction of the last `[n/total,` counter in `chunk`, or null when it has none. */
export function progressFraction(chunk: string): number | null {
  const last = [...chunk.matchAll(PROGRESS)].pop();
  if (!last) { return null; }
  const total = Number(last[2]);
  return total > 0 ? Number(last[1]) / total : null;
}

function quote(part: string): string {
  return `"${part.replace(/"/g, '""')}"`;
}

export async function runTexTool(run: TexToolRun): Promise<TexToolOutcome> {
  // PLATFORM: on Windows tlmgr and install-tl are .bat files, which only a shell can start.
  const shell = process.platform === "win32";
  const executable = shell ? [run.executable, ...run.args].map(quote).join(" ") : run.executable;
  const onOutput = (chunk: string): void => {
    const fraction = run.onProgress ? progressFraction(chunk) : null;
    if (fraction !== null) { run.onProgress?.(fraction); }
  };
  await run.logger.log("INFO", TEX_MODULE, "Running a TeX tool", { executable: run.executable, args: run.args });
  const outcome = await runCancellable(executable, shell ? [] : run.args, run.cwd, new AbortController().signal, { shell, onOutput });
  await run.logger.log(outcome.code === 0 ? "INFO" : "WARN", TEX_MODULE, "A TeX tool exited", {
    executable: run.executable, args: run.args, code: outcome.code, ...(outcome.code === 0 ? {} : { output: outcome.output.slice(-2000) }),
  });
  return outcome;
}
