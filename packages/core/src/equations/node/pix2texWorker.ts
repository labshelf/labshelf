// Keeps one pix2tex worker process alive, one JSON line per request: starts it on the first read, drops it when idle, on
// timeout, on cancel or on exit, and fails the request pending on it.
import type { Pix2texFound } from "./pix2texFinder.js";

export interface WorkerProcess { stdin: { write(chunk: string): boolean }; stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream; kill(): boolean; on(event: 'exit', listener: (code: number | null) => void): unknown }

export type SpawnLike = (command: string, args: string[], env: Record<string, string>) => WorkerProcess;

export interface Pix2texWorkerDeps {
  spawn: SpawnLike;
  /** The worker script's path. */
  script: string;
  idleMs: number;
  timeoutMs: number;
  note(level: "INFO" | "WARN", message: string, context?: Record<string, unknown>): void;
}

interface Live {
  process: WorkerProcess;
  pending?: { id: number; settle: (outcome: { latex: string } | { error: Error }) => void } | undefined;
}

/** Splits a stream into lines; the partial last line waits for its newline. */
function onLines(stream: NodeJS.ReadableStream, handle: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk: string | Buffer) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line !== "") { handle(line); }
      newline = buffer.indexOf("\n");
    }
  });
}

function workerEnv(found: Pix2texFound): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) { if (value !== undefined) { env[key] = value; } }
  env["PYTHONUNBUFFERED"] = "1";
  env["PYTHONIOENCODING"] = "utf-8";
  if (found.weightsDir !== undefined) { env["LABSHELF_PIX2TEX_WEIGHTS"] = found.weightsDir; }
  return env;
}

export class Pix2texWorkerHost {
  private live: Live | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private nextId = 1;
  private readonly deps: Pix2texWorkerDeps;

  constructor(deps: Pix2texWorkerDeps) {
    this.deps = deps;
  }

  /** Sends the image to the live worker, started with `found` when there is none; the idle timer restarts when the reply comes. */
  read(found: Pix2texFound, png: Uint8Array, signal: AbortSignal | undefined): Promise<string> {
    this.clearIdle();
    const worker = this.live ?? this.start(found);
    return this.request(worker, this.nextId++, png, signal);
  }

  dispose(): void {
    if (this.live !== undefined) { this.stop(this.live, "The pix2tex runner was disposed"); }
  }

  private clearIdle(): void {
    if (this.idleTimer !== undefined) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
  }

  /** Drops the worker from use and kills it; a request pending on it fails with `reason`. */
  private stop(worker: Live, reason: string): void {
    if (this.live === worker) { this.live = undefined; this.clearIdle(); }
    const pending = worker.pending;
    worker.pending = undefined;
    try { worker.process.kill(); } catch (error) { this.deps.note("WARN", "Could not kill the pix2tex worker", { error: String(error) }); }
    pending?.settle({ error: new Error(reason) });
  }

  private start(found: Pix2texFound): Live {
    const child = this.deps.spawn(found.python, [this.deps.script], workerEnv(found));
    const worker: Live = { process: child };
    onLines(child.stdout, (line) => this.handleReply(worker, line));
    onLines(child.stderr, (line) => this.deps.note("INFO", "pix2tex worker", { line }));
    child.on("exit", (code) => this.handleExit(worker, code));
    this.live = worker;
    return worker;
  }

  private handleReply(worker: Live, line: string): void {
    if (this.live !== worker) { return; }
    let reply: { id?: unknown; latex?: unknown; error?: unknown };
    try { reply = JSON.parse(line) as typeof reply; } catch { this.deps.note("WARN", "Unreadable pix2tex worker reply", { line: line.slice(0, 200) }); return; }
    const pending = worker.pending;
    if (pending === undefined || reply.id !== pending.id) { return; }
    worker.pending = undefined;
    if (typeof reply.error === "string") { pending.settle({ error: new Error(reply.error) }); }
    else { pending.settle({ latex: typeof reply.latex === "string" ? reply.latex : "" }); }
  }

  private handleExit(worker: Live, code: number | null): void {
    if (this.live !== worker) { return; }
    this.live = undefined;
    this.clearIdle();
    const pending = worker.pending;
    worker.pending = undefined;
    if (pending !== undefined) { pending.settle({ error: new Error(`The pix2tex worker exited with code ${String(code)}`) }); }
    else { this.deps.note("INFO", "The pix2tex worker exited", { code }); }
  }

  private request(worker: Live, id: number, png: Uint8Array, signal: AbortSignal | undefined): Promise<string> {
    const { timeoutMs, idleMs } = this.deps;
    return new Promise<string>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const onAbort = (): void => { this.stop(worker, "The pix2tex read was cancelled"); };
      const finish = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      worker.pending = {
        id,
        settle: (outcome) => {
          finish();
          if ("error" in outcome) {
            reject(outcome.error);
            return;
          }
          if (this.live === worker && idleMs > 0) {
            this.idleTimer = setTimeout(() => { this.stop(worker, "The pix2tex worker was idle"); }, idleMs);
            this.idleTimer.unref?.();
          }
          resolve(outcome.latex);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => { this.stop(worker, `pix2tex did not answer within ${String(timeoutMs)} ms`); }, timeoutMs);
      timer.unref?.();
      try {
        worker.process.stdin.write(`${JSON.stringify({ id, png: Buffer.from(png).toString("base64") })}\n`);
      } catch (error) {
        this.stop(worker, `Could not send the image to pix2tex: ${String(error)}`);
      }
    });
  }
}
