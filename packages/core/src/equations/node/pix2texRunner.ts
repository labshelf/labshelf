// Reads equation images with pix2tex: finds a Python that has it (setting, then the managed install, then the system) and keeps one worker process alive, one JSON line per request.
// CONTRACT: documents/contracts/managed-tools.md#pix2tex
import { join } from "node:path";
import type { ILogger } from "../../ports/index.js";
import type { EquationSource } from "../extractor.js";
import type { Pix2texProvider } from "./installPix2tex.js";

const MODULE = "equations/node/pix2texRunner";
const DEFAULT_IDLE_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface WorkerProcess { stdin: { write(chunk: string): boolean }; stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream; kill(): boolean; on(event: 'exit', listener: (code: number | null) => void): unknown }

export type SpawnLike = (command: string, args: string[], env: Record<string, string>) => WorkerProcess;

export interface Pix2texRunner { find(): Promise<{ python: string; origin: 'setting' | 'managed' | 'system'; weightsDir?: string } | undefined>; read(png: Uint8Array, signal?: AbortSignal): Promise<string>; dispose(): void }

/** The worker script beside this module. PLATFORM: core compiles to CommonJS for Node, where __dirname is this folder; an ESM bundle must ship the script beside itself. */
function workerScript(): string {
  if (typeof __dirname === "undefined") { return join("pix2tex_worker.py"); }
  return join(__dirname, "pix2tex_worker.py");
}

export const PIX2TEX_WORKER_SCRIPT: string = workerScript();

type Found = { python: string; origin: 'setting' | 'managed' | 'system'; weightsDir?: string };

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

/** `workerScript` is the worker's path when it is not beside this module, as in the helper executable. */
export function createPix2texRunner(deps: { settingPython(): string | undefined; managed: Pick<Pix2texProvider, 'status' | 'pythonPath' | 'weightsDir'>; locatePython(): Promise<string | undefined>; canImport(python: string): Promise<boolean>; spawn: SpawnLike; idleMs?: number; timeoutMs?: number; workerScript?: string; logger: ILogger }): Pix2texRunner {
  const { logger } = deps;
  const script = deps.workerScript ?? PIX2TEX_WORKER_SCRIPT;
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const importable = new Map<string, Promise<boolean>>();
  let live: Live | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let nextId = 1;
  let queue: Promise<unknown> = Promise.resolve();

  const note = (level: "INFO" | "WARN", message: string, context?: Record<string, unknown>): void => {
    void logger.log(level, MODULE, message, context).catch(() => undefined);
  };

  function canImport(python: string): Promise<boolean> {
    let known = importable.get(python);
    if (known === undefined) {
      known = deps.canImport(python).catch((error: unknown) => {
        void logger.error(MODULE, error, { python }).catch(() => undefined);
        return false;
      });
      importable.set(python, known);
    }
    return known;
  }

  async function find(): Promise<Found | undefined> {
    const setting = deps.settingPython();
    if (setting !== undefined && setting !== "") { return { python: setting, origin: "setting" }; }
    if (await deps.managed.status() === "installed") {
      return { python: deps.managed.pythonPath(), origin: "managed", weightsDir: deps.managed.weightsDir() };
    }
    const system = await deps.locatePython();
    if (system !== undefined && await canImport(system)) { return { python: system, origin: "system" }; }
    return undefined;
  }

  function clearIdle(): void {
    if (idleTimer !== undefined) { clearTimeout(idleTimer); idleTimer = undefined; }
  }

  /** Drops the worker from use and kills it; a request pending on it fails with `reason`. */
  function stop(worker: Live, reason: string): void {
    if (live === worker) { live = undefined; clearIdle(); }
    const pending = worker.pending;
    worker.pending = undefined;
    try { worker.process.kill(); } catch (error) { note("WARN", "Could not kill the pix2tex worker", { error: String(error) }); }
    pending?.settle({ error: new Error(reason) });
  }

  function start(found: Found): Live {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) { if (value !== undefined) { env[key] = value; } }
    env["PYTHONUNBUFFERED"] = "1";
    env["PYTHONIOENCODING"] = "utf-8";
    if (found.weightsDir !== undefined) { env["LABSHELF_PIX2TEX_WEIGHTS"] = found.weightsDir; }
    const child = deps.spawn(found.python, [script], env);
    const worker: Live = { process: child };
    onLines(child.stdout, (line) => {
      if (live !== worker) { return; }
      let reply: { id?: unknown; latex?: unknown; error?: unknown };
      try { reply = JSON.parse(line) as typeof reply; } catch { note("WARN", "Unreadable pix2tex worker reply", { line: line.slice(0, 200) }); return; }
      const pending = worker.pending;
      if (pending === undefined || reply.id !== pending.id) { return; }
      worker.pending = undefined;
      if (typeof reply.error === "string") { pending.settle({ error: new Error(reply.error) }); }
      else { pending.settle({ latex: typeof reply.latex === "string" ? reply.latex : "" }); }
    });
    onLines(child.stderr, (line) => note("INFO", "pix2tex worker", { line }));
    child.on("exit", (code) => {
      if (live !== worker) { return; }
      live = undefined;
      clearIdle();
      const pending = worker.pending;
      worker.pending = undefined;
      if (pending !== undefined) { pending.settle({ error: new Error(`The pix2tex worker exited with code ${String(code)}`) }); }
      else { note("INFO", "The pix2tex worker exited", { code }); }
    });
    live = worker;
    return worker;
  }

  async function readNow(png: Uint8Array, signal: AbortSignal | undefined): Promise<string> {
    if (signal?.aborted) { throw new Error("The pix2tex read was cancelled"); }
    const found = await find();
    if (found === undefined) { throw new Error("pix2tex is not available: install it or set a Python that has it"); }
    if (signal?.aborted) { throw new Error("The pix2tex read was cancelled"); }
    clearIdle();
    const worker = live ?? start(found);
    const id = nextId++;
    return new Promise<string>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const onAbort = (): void => { stop(worker, "The pix2tex read was cancelled"); };
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
          if (live === worker && idleMs > 0) {
            idleTimer = setTimeout(() => { stop(worker, "The pix2tex worker was idle"); }, idleMs);
            idleTimer.unref?.();
          }
          resolve(outcome.latex);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => { stop(worker, `pix2tex did not answer within ${String(timeoutMs)} ms`); }, timeoutMs);
      timer.unref?.();
      try {
        worker.process.stdin.write(`${JSON.stringify({ id, png: Buffer.from(png).toString("base64") })}\n`);
      } catch (error) {
        stop(worker, `Could not send the image to pix2tex: ${String(error)}`);
      }
    });
  }

  return {
    find,
    read(png, signal) {
      const run = queue.then(() => readNow(png, signal));
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() {
      if (live !== undefined) { stop(live, "The pix2tex runner was disposed"); }
    },
  };
}

export function createPix2texSource(runner: Pix2texRunner): EquationSource {
  return {
    id: "pix2tex",
    async available() { return (await runner.find()) !== undefined; },
    async read(request, _onProgress, signal) {
      const latex = await runner.read(request.png, signal);
      return latex === "" ? undefined : { latex };
    },
  };
}
