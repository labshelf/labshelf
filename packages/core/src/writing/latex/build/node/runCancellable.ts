/** Runs a process to its end and kills it with all its children when it is cancelled. */
import { spawn } from "node:child_process";

export interface ProcessOutcome {
  code: number | null;
  /** The tail of stdout and stderr, interleaved. */
  output: string;
}

const OUTPUT_LIMIT = 64 * 1024;

export interface CancellableOptions {
  /** Runs `executable` as a shell command line, with `args` empty. */
  shell?: boolean;
  /** Receives each chunk of stdout and stderr as it arrives. */
  onOutput?: (chunk: string) => void;
}

export class BuildCancelled extends Error {
  constructor() {
    super("The build was cancelled");
    this.name = "BuildCancelled";
  }
}

// PLATFORM: latexmk starts the engine as a child; killing latexmk alone leaves it writing to the build folder,
// so the whole process group (Unix) or tree (Windows) goes.
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // The group already exited.
  }
}

export function runCancellable(
  executable: string, args: string[], cwd: string, signal: AbortSignal, options: CancellableOptions = {},
): Promise<ProcessOutcome> {
  if (signal.aborted) { return Promise.reject(new BuildCancelled()); }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, shell: options.shell ?? false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      output = (output + text).slice(-OUTPUT_LIMIT);
      options.onOutput?.(text);
    };
    const onAbort = (): void => { if (child.pid !== undefined) { killTree(child.pid); } };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) { reject(new BuildCancelled()); } else { resolve({ code, output }); }
    });
  });
}
