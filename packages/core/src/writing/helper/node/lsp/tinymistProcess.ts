// Runs one `tinymist lsp` child process and exchanges framed JSON-RPC messages with it.
import type { ILogger } from "../../../../ports/index.js";
import { createLspFrameParser, encodeLspFrame } from "./lspFraming.js";
import type { SpawnLsp } from "./tinymistTypes.js";

const MODULE = "helper/lsp";
const STDERR_TAIL_BYTES = 2000;

export interface TinymistProcess {
  write(message: unknown): void;
  stop(): void;
}

export interface TinymistProcessOptions {
  binary: string;
  /** The working copy; also the project root Tinymist resolves paths against. */
  cwd: string;
  env: Record<string, string>;
  projectId: string;
  spawn: SpawnLsp;
  logger: ILogger;
  onMessage(message: unknown): void;
  /** Called once when the process ends without `stop()`. */
  onUnexpectedExit(): void;
}

export function startTinymistProcess(options: TinymistProcessOptions): TinymistProcess {
  const { logger, projectId } = options;
  const child = options.spawn(options.binary, ["lsp"], { cwd: options.cwd, env: options.env });
  let stopped = false;
  let stderrTail = "";
  const parse = createLspFrameParser(options.onMessage, (reason) => {
    void logger.log("WARN", MODULE, "Language server sent an unreadable frame", { projectId, reason });
  });
  child.stdout.on("data", parse);
  // Tinymist logs its progress on stderr; only the tail matters, for an exit that nobody asked for.
  child.stderr.on("data", (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES); });
  child.stdin.on("error", (error) => { void logger.error(MODULE, error, { projectId, where: "stdin" }); });
  child.on("error", (error) => {
    void logger.error(MODULE, error, { projectId, where: "spawn" });
    if (!stopped) { stopped = true; options.onUnexpectedExit(); }
  });
  child.on("exit", (code, signal) => {
    if (stopped) { return; }
    stopped = true;
    void logger.log("WARN", MODULE, "Language server exited", { projectId, code, signal, stderrTail });
    options.onUnexpectedExit();
  });
  return {
    write: (message) => { if (!stopped) { child.stdin.write(encodeLspFrame(message)); } },
    stop: () => {
      if (stopped) { return; }
      stopped = true;
      child.kill();
    },
  };
}
