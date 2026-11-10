// Reads equation images with pix2tex: finds a Python that has it (`pix2texFinder.ts`) and keeps one worker process alive (`pix2texWorker.ts`), one request at a time.
// CONTRACT: documents/contracts/managed-tools.md#pix2tex
import { join } from "node:path";
import type { ILogger } from "../../ports/index.js";
import type { EquationSource } from "../extractor.js";
import type { Pix2texProvider } from "./installPix2tex.js";
import { createPix2texFinder, type Pix2texFound } from "./pix2texFinder.js";
import { Pix2texWorkerHost, type SpawnLike } from "./pix2texWorker.js";

export type { SpawnLike, WorkerProcess } from "./pix2texWorker.js";

const MODULE = "equations/node/pix2texRunner";
const DEFAULT_IDLE_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface Pix2texRunner { find(): Promise<Pix2texFound | undefined>; read(png: Uint8Array, signal?: AbortSignal): Promise<string>; dispose(): void }

/** The worker script beside this module. PLATFORM: core compiles to CommonJS for Node, where __dirname is this folder; an ESM bundle must ship the script beside itself. */
function workerScript(): string {
  if (typeof __dirname === "undefined") { return join("pix2tex_worker.py"); }
  return join(__dirname, "pix2tex_worker.py");
}

export const PIX2TEX_WORKER_SCRIPT: string = workerScript();

/** `workerScript` is the worker's path when it is not beside this module, as in the helper executable. */
export function createPix2texRunner(deps: { settingPython(): string | undefined; managed: Pick<Pix2texProvider, 'status' | 'pythonPath' | 'weightsDir'>; locatePython(): Promise<string | undefined>; canImport(python: string): Promise<boolean>; spawn: SpawnLike; idleMs?: number; timeoutMs?: number; workerScript?: string; logger: ILogger }): Pix2texRunner {
  const { logger } = deps;
  const find = createPix2texFinder(deps);
  const host = new Pix2texWorkerHost({
    spawn: deps.spawn,
    script: deps.workerScript ?? PIX2TEX_WORKER_SCRIPT,
    idleMs: deps.idleMs ?? DEFAULT_IDLE_MS,
    timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    note: (level, message, context) => { void logger.log(level, MODULE, message, context).catch(() => undefined); },
  });
  let queue: Promise<unknown> = Promise.resolve();

  async function readNow(png: Uint8Array, signal: AbortSignal | undefined): Promise<string> {
    if (signal?.aborted) { throw new Error("The pix2tex read was cancelled"); }
    const found = await find();
    if (found === undefined) { throw new Error("pix2tex is not available: install it or set a Python that has it"); }
    if (signal?.aborted) { throw new Error("The pix2tex read was cancelled"); }
    return host.read(found, png, signal);
  }

  return {
    find,
    read(png, signal) {
      const run = queue.then(() => readNow(png, signal));
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() { host.dispose(); },
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
