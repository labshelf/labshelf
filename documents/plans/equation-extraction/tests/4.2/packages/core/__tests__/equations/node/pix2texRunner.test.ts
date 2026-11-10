/** Contract of the pix2tex runner: Python discovery order, one persistent JSON-lines worker, timeout, cancel, idle and crash handling, and the EquationSource wrapper. */
import { EventEmitter } from "node:events";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import {
  createPix2texRunner,
  createPix2texSource,
  PIX2TEX_WORKER_SCRIPT,
  type Pix2texRunner,
  type SpawnLike,
  type WorkerProcess,
} from "../../../src/equations/node/pix2texRunner.js";
import type { Pix2texProvider } from "../../../src/equations/node/installPix2tex.js";
import type { EquationRequest } from "../../../src/reader/hostPorts.js";
import type { ILogger } from "../../../src/ports/index.js";

type Managed = Pick<Pix2texProvider, "status" | "pythonPath" | "weightsDir">;
type Message = { id: number | string; png: string };
type Reply = Record<string, unknown>;

/** A scripted worker: records the JSON lines it receives and answers through `handle` (return nothing to stay silent). */
class FakeWorker extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Message[] = [];
  kills = 0;
  private buffer = "";
  readonly stdin = {
    write: (chunk: string): boolean => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.trim() !== "") {
          const message = JSON.parse(line) as Message;
          this.requests.push(message);
          const answer = this.handle(message, this);
          if (answer !== undefined) { this.reply(answer); }
        }
        newline = this.buffer.indexOf("\n");
      }
      return true;
    },
  };
  constructor(private readonly handle: (message: Message, worker: FakeWorker) => Reply | undefined) { super(); }
  reply(answer: Reply): void { this.stdout.write(`${JSON.stringify(answer)}\n`); }
  crash(code: number | null = 1): void { this.emit("exit", code); }
  kill(): boolean {
    this.kills++;
    setImmediate(() => this.emit("exit", null));
    return true;
  }
}

interface Harness {
  runner: Pix2texRunner;
  workers: FakeWorker[];
  spawns: { command: string; args: string[]; env: Record<string, string> }[];
  canImport: jest.Mock<Promise<boolean>, [string]>;
  locatePython: jest.Mock<Promise<string | undefined>, []>;
  logged: unknown[][];
}

const echo = (message: Message): Reply => ({ id: message.id, latex: "x^2" });

function setup(options: {
  setting?: string | undefined;
  managed?: Partial<Managed> & { state?: "installed" | "missing" | "unsupported" };
  system?: string | undefined;
  importable?: boolean | Record<string, boolean>;
  handle?: (message: Message, worker: FakeWorker) => Reply | undefined;
  idleMs?: number;
  timeoutMs?: number;
} = {}): Harness {
  const workers: FakeWorker[] = [];
  const spawns: Harness["spawns"] = [];
  const logged: unknown[][] = [];
  const handle = options.handle ?? echo;
  const spawn: SpawnLike = (command, args, env) => {
    spawns.push({ command, args, env });
    const worker = new FakeWorker(handle);
    workers.push(worker);
    return worker as unknown as WorkerProcess;
  };
  const managed: Managed = {
    status: options.managed?.status ?? (async () => options.managed?.state ?? "missing"),
    pythonPath: options.managed?.pythonPath ?? (() => "/managed/venv/bin/python"),
    weightsDir: options.managed?.weightsDir ?? (() => "/managed/weights"),
  };
  const canImport = jest.fn(async (python: string) => {
    const importable = options.importable ?? true;
    return typeof importable === "boolean" ? importable : importable[python] === true;
  });
  const locatePython = jest.fn(async () => options.system);
  const logger = {
    log: async (...args: unknown[]) => { logged.push(args); },
    error: async (...args: unknown[]) => { logged.push(args); },
  } as unknown as ILogger;
  const runner = createPix2texRunner({
    settingPython: () => options.setting,
    managed,
    locatePython,
    canImport,
    spawn,
    ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    logger,
  });
  return { runner, workers, spawns, canImport, locatePython, logged };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function until(condition: () => boolean, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts && !condition(); i++) { await tick(); }
  if (!condition()) { throw new Error("condition never became true"); }
}

async function settle(): Promise<void> { for (let i = 0; i < 10; i++) { await tick(); } }

/** Waits until the first worker exists and has received its first request. */
async function untilFirstRequest(h: Harness): Promise<FakeWorker> {
  await until(() => h.workers.length > 0 && h.workers[0]!.requests.length > 0);
  return h.workers[0]!;
}

const png = (...bytes: number[]) => new Uint8Array(bytes.length > 0 ? bytes : [137, 80, 78, 71]);

const fakeTimers = () => jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });

describe("pix2tex runner: finding a Python (4.2a, A7)", () => {
  it("4.2a a non-empty setting wins over a managed install and the system, with no weightsDir", async () => {
    const h = setup({ setting: "/custom/python", managed: { state: "installed" }, system: "/usr/bin/python3" });
    expect(await h.runner.find()).toEqual({ python: "/custom/python", origin: "setting" });
  });

  it("4.2a an installed managed pix2tex beats the system Python and reports its weightsDir", async () => {
    const h = setup({ managed: { state: "installed" }, system: "/usr/bin/python3" });
    expect(await h.runner.find()).toEqual({ python: "/managed/venv/bin/python", origin: "managed", weightsDir: "/managed/weights" });
  });

  it("4.2a an empty setting falls through to the managed install", async () => {
    const h = setup({ setting: "", managed: { state: "installed" } });
    expect((await h.runner.find())?.origin).toBe("managed");
  });

  it.each(["missing", "unsupported"] as const)("4.2a a %s managed install falls through to the system Python", async (state) => {
    const h = setup({ managed: { state }, system: "/usr/bin/python3" });
    expect(await h.runner.find()).toEqual({ python: "/usr/bin/python3", origin: "system" });
  });

  it("4.2a a system Python that cannot import pix2tex does not count", async () => {
    const h = setup({ system: "/usr/bin/python3", importable: false });
    expect(await h.runner.find()).toBeUndefined();
    expect(h.canImport).toHaveBeenCalledWith("/usr/bin/python3");
  });

  it("4.2a no Python at all finds nothing", async () => {
    const h = setup({ system: undefined });
    expect(await h.runner.find()).toBeUndefined();
  });

  it("4.2a canImport is called at most once per python path across repeated finds", async () => {
    const h = setup({ system: "/usr/bin/python3" });
    await h.runner.find();
    await h.runner.find();
    await h.runner.find();
    expect(h.canImport.mock.calls.filter(([python]) => python === "/usr/bin/python3").length).toBeLessThanOrEqual(1);
  });

  it("4.2a a setting Python is not probed with canImport", async () => {
    const h = setup({ setting: "/custom/python" });
    await h.runner.find();
    expect(h.canImport).not.toHaveBeenCalled();
  });

  it("4.2a read with nothing found rejects with an error that names pix2tex and spawns nothing", async () => {
    const h = setup({ system: undefined });
    await expect(h.runner.read(png())).rejects.toThrow(/pix2tex/);
    expect(h.spawns).toHaveLength(0);
  });
});

describe("pix2tex runner: the persistent worker (4.2b, A7)", () => {
  it("A7 the worker script path is absolute and names pix2tex_worker.py", () => {
    expect(path.isAbsolute(PIX2TEX_WORKER_SCRIPT)).toBe(true);
    expect(path.basename(PIX2TEX_WORKER_SCRIPT)).toBe("pix2tex_worker.py");
  });

  it("A7 spawns the found python with the worker script as its only argument", async () => {
    const h = setup({ setting: "/custom/python" });
    await h.runner.read(png());
    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0]?.command).toBe("/custom/python");
    expect(h.spawns[0]?.args).toEqual([PIX2TEX_WORKER_SCRIPT]);
    h.runner.dispose();
  });

  it("A7 sets LABSHELF_PIX2TEX_WEIGHTS in the worker environment when the weights directory is known", async () => {
    const h = setup({ managed: { state: "installed" } });
    await h.runner.read(png());
    expect(h.spawns[0]?.env["LABSHELF_PIX2TEX_WEIGHTS"]).toBe("/managed/weights");
    h.runner.dispose();
  });

  it("A7 writes one JSON line {id, png: base64} per request and resolves with the matching latex", async () => {
    const h = setup({ setting: "/p", handle: (m) => ({ id: m.id, latex: "\\frac{a}{b}" }) });
    const bytes = png(1, 2, 3, 250, 251);
    await expect(h.runner.read(bytes)).resolves.toBe("\\frac{a}{b}");
    expect(h.workers[0]?.requests).toHaveLength(1);
    expect(h.workers[0]?.requests[0]?.png).toBe(Buffer.from(bytes).toString("base64"));
    expect(h.workers[0]?.requests[0]?.id).toBeDefined();
    h.runner.dispose();
  });

  it("4.2b two reads reuse one worker", async () => {
    const h = setup({ setting: "/p" });
    await h.runner.read(png(1));
    await h.runner.read(png(2));
    expect(h.spawns).toHaveLength(1);
    expect(h.workers[0]?.requests).toHaveLength(2);
    h.runner.dispose();
  });

  it("A7 each request gets a distinct id and each reply goes to its own request", async () => {
    const h = setup({ setting: "/p", handle: (m) => ({ id: m.id, latex: `r-${m.png}` }) });
    const first = await h.runner.read(png(1));
    const second = await h.runner.read(png(2));
    expect(first).toBe(`r-${Buffer.from(png(1)).toString("base64")}`);
    expect(second).toBe(`r-${Buffer.from(png(2)).toString("base64")}`);
    const ids = h.workers[0]!.requests.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
    h.runner.dispose();
  });

  it("A7 an {id, error} reply rejects with that error and keeps the worker for the next read", async () => {
    let calls = 0;
    const h = setup({ setting: "/p", handle: (m) => (++calls === 1 ? { id: m.id, error: "model blew up" } : { id: m.id, latex: "ok" }) });
    await expect(h.runner.read(png())).rejects.toThrow(/model blew up/);
    await expect(h.runner.read(png())).resolves.toBe("ok");
    expect(h.spawns).toHaveLength(1);
    expect(h.workers[0]?.kills).toBe(0);
    h.runner.dispose();
  });

  it("A7 requests are serialised: the second line is written only after the first reply", async () => {
    const h = setup({ setting: "/p", handle: () => undefined });
    const first = h.runner.read(png(1));
    const second = h.runner.read(png(2));
    const worker = await untilFirstRequest(h);
    await settle();
    expect(worker.requests).toHaveLength(1);
    worker.reply({ id: worker.requests[0]!.id, latex: "one" });
    await expect(first).resolves.toBe("one");
    await until(() => worker.requests.length >= 2);
    worker.reply({ id: worker.requests[1]!.id, latex: "two" });
    await expect(second).resolves.toBe("two");
    expect(h.spawns).toHaveLength(1);
    h.runner.dispose();
  });

  it("A7 worker stderr goes to the logger", async () => {
    const h = setup({ setting: "/p", handle: () => undefined });
    const pending = h.runner.read(png());
    const worker = await untilFirstRequest(h);
    worker.stderr.write("loading weights from somewhere\n");
    await until(() => JSON.stringify(h.logged).includes("loading weights from somewhere"));
    worker.reply({ id: worker.requests[0]!.id, latex: "x" });
    await pending;
    h.runner.dispose();
  });

  it("4.2b dispose kills the worker and the next read starts a new one", async () => {
    const h = setup({ setting: "/p" });
    await h.runner.read(png());
    h.runner.dispose();
    expect(h.workers[0]?.kills).toBe(1);
    await settle();
    await h.runner.read(png());
    expect(h.spawns).toHaveLength(2);
    h.runner.dispose();
  });

  it("4.2b dispose with no worker running does not throw", () => {
    const h = setup({ setting: "/p" });
    expect(() => h.runner.dispose()).not.toThrow();
  });
});

describe("pix2tex runner: timeout, cancel, idle and crash (4.2b, A7)", () => {
  afterEach(() => { jest.useRealTimers(); });

  it("4.2b a request with no reply for timeoutMs rejects and kills the worker", async () => {
    fakeTimers();
    const h = setup({ setting: "/p", handle: () => undefined, timeoutMs: 5000 });
    const outcome = h.runner.read(png()).then(() => "resolved", (e: unknown) => e);
    await untilFirstRequest(h);
    await jest.advanceTimersByTimeAsync(4999);
    expect(h.workers[0]?.kills).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(Error);
    expect(h.workers[0]?.kills).toBe(1);
  });

  it("4.2b the next read after a timeout starts a new worker", async () => {
    fakeTimers();
    let calls = 0;
    const h = setup({ setting: "/p", timeoutMs: 1000, handle: (m) => (++calls === 1 ? undefined : { id: m.id, latex: "fresh" }) });
    const first = h.runner.read(png()).then(() => "resolved", () => "rejected");
    await untilFirstRequest(h);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await first).toBe("rejected");
    await expect(h.runner.read(png())).resolves.toBe("fresh");
    expect(h.spawns).toHaveLength(2);
    h.runner.dispose();
  });

  it("A7 the default timeout is 60000 ms", async () => {
    fakeTimers();
    const h = setup({ setting: "/p", handle: () => undefined });
    const outcome = h.runner.read(png()).then(() => "resolved", () => "rejected");
    await untilFirstRequest(h);
    await jest.advanceTimersByTimeAsync(59999);
    expect(h.workers[0]?.kills).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("rejected");
    expect(h.workers[0]?.kills).toBe(1);
  });

  it("4.2b aborting the signal rejects the pending read and kills the worker", async () => {
    const h = setup({ setting: "/p", handle: () => undefined });
    const controller = new AbortController();
    const outcome = h.runner.read(png(), controller.signal).then(() => "resolved", (e: unknown) => e);
    await untilFirstRequest(h);
    controller.abort();
    expect(await outcome).toBeInstanceOf(Error);
    expect(h.workers[0]?.kills).toBe(1);
  });

  it("4.2b the next read after a cancel starts a new worker", async () => {
    let calls = 0;
    const h = setup({ setting: "/p", handle: (m) => (++calls === 1 ? undefined : { id: m.id, latex: "again" }) });
    const controller = new AbortController();
    const first = h.runner.read(png(), controller.signal).then(() => "resolved", () => "rejected");
    await untilFirstRequest(h);
    controller.abort();
    expect(await first).toBe("rejected");
    await settle();
    await expect(h.runner.read(png())).resolves.toBe("again");
    expect(h.spawns).toHaveLength(2);
    h.runner.dispose();
  });

  it("4.2b a worker exiting with a request pending rejects it, and the next read starts a new worker", async () => {
    let calls = 0;
    const h = setup({ setting: "/p", handle: (m) => (++calls === 1 ? undefined : { id: m.id, latex: "recovered" }) });
    const first = h.runner.read(png()).then(() => "resolved", (e: unknown) => e);
    const worker = await untilFirstRequest(h);
    worker.crash(139);
    expect(await first).toBeInstanceOf(Error);
    await expect(h.runner.read(png())).resolves.toBe("recovered");
    expect(h.spawns).toHaveLength(2);
    h.runner.dispose();
  });

  it("4.2b a worker that exits while idle is replaced on the next read", async () => {
    const h = setup({ setting: "/p" });
    await h.runner.read(png());
    h.workers[0]!.crash(1);
    await settle();
    await expect(h.runner.read(png())).resolves.toBe("x^2");
    expect(h.spawns).toHaveLength(2);
    h.runner.dispose();
  });

  it("4.2b idleMs after the last reply the worker is killed", async () => {
    fakeTimers();
    const h = setup({ setting: "/p", idleMs: 10000 });
    await h.runner.read(png());
    await jest.advanceTimersByTimeAsync(9999);
    expect(h.workers[0]?.kills).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.workers[0]?.kills).toBe(1);
  });

  it("4.2b a read after the idle kill spawns a new worker", async () => {
    fakeTimers();
    const h = setup({ setting: "/p", idleMs: 1000 });
    await h.runner.read(png());
    await jest.advanceTimersByTimeAsync(1010);
    await expect(h.runner.read(png())).resolves.toBe("x^2");
    expect(h.spawns).toHaveLength(2);
    h.runner.dispose();
  });

  it("4.2b a new reply restarts the idle countdown", async () => {
    fakeTimers();
    const h = setup({ setting: "/p", idleMs: 10000 });
    await h.runner.read(png());
    await jest.advanceTimersByTimeAsync(6000);
    await h.runner.read(png());
    await jest.advanceTimersByTimeAsync(6000);
    expect(h.workers[0]?.kills).toBe(0);
    expect(h.spawns).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(4000);
    expect(h.workers[0]?.kills).toBe(1);
  });

  it("A7 the default idle time is 300000 ms", async () => {
    fakeTimers();
    const h = setup({ setting: "/p" });
    await h.runner.read(png());
    await jest.advanceTimersByTimeAsync(299999);
    expect(h.workers[0]?.kills).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.workers[0]?.kills).toBe(1);
  });
});

describe("pix2tex source (4.2a, A7)", () => {
  const request = (): EquationRequest => ({
    paperId: "paper-1",
    pageNumber: 2,
    rect: { x0: 0, x1: 10, yTop: 20, yBottom: 5 },
    text: "E = mc2",
    png: png(9, 8, 7),
  });
  const fakeRunner = (overrides: Partial<Pix2texRunner>): Pix2texRunner => ({
    find: async () => undefined,
    read: async () => "",
    dispose: () => undefined,
    ...overrides,
  });

  it("4.2a the source has id pix2tex", () => {
    expect(createPix2texSource(fakeRunner({})).id).toBe("pix2tex");
  });

  it("4.2a the source is unavailable when the runner finds no python", async () => {
    expect(await createPix2texSource(fakeRunner({ find: async () => undefined })).available(request())).toBe(false);
  });

  it("4.2a the source is available when the runner finds a python", async () => {
    const found = { python: "/p", origin: "system" as const };
    expect(await createPix2texSource(fakeRunner({ find: async () => found })).available(request())).toBe(true);
  });

  it("4.2a with nothing installed anywhere the source built on a real runner is unavailable", async () => {
    const h = setup({ system: undefined });
    expect(await createPix2texSource(h.runner).available(request())).toBe(false);
  });

  it("A7 read returns the runner's latex for the request png, passing the signal through", async () => {
    const read = jest.fn(async (_png: Uint8Array, _signal?: AbortSignal) => "\\alpha + \\beta");
    const source = createPix2texSource(fakeRunner({ read }));
    const req = request();
    const controller = new AbortController();
    expect(await source.read(req, jest.fn(), controller.signal)).toEqual({ latex: "\\alpha + \\beta" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toBe(req.png);
    expect(read.mock.calls[0]?.[1]).toBe(controller.signal);
  });

  it("A7 read returns undefined for an empty reply", async () => {
    const source = createPix2texSource(fakeRunner({ read: async () => "" }));
    expect(await source.read(request(), () => undefined)).toBeUndefined();
  });

  it("A7 read propagates a runner failure", async () => {
    const source = createPix2texSource(fakeRunner({ read: async () => { throw new Error("worker died"); } }));
    await expect(source.read(request(), () => undefined)).rejects.toThrow(/worker died/);
  });
});
