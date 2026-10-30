/** Verifies the params/preview/controls plumbing of the cell run flow: createCellRuns previews, the session request line and controls in a driver response. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { toCellLanguage, type CellLanguage } from "../../../../src/qmd/compute/cellLanguage";
import { createCellRuns, type CellResult, type CellRunState, type CellRunTarget, type CellRuns, type RunCellPort } from "../../../../src/qmd/compute/cellRunner";
import { createCellSessions } from "../../../../src/qmd/compute/node/cellSessions";
import { findOutputs } from "../../../../src/qmd/item/cellOutput";
import { readOutputParams } from "../../../../src/qmd/item/cellParams";
import { fakeLogger } from "../../../support/fakeLogger";

const PY = toCellLanguage("python") as CellLanguage;
const CODE = "beta * 2\n";
const BODY = "```{python}\n#| label: c\n" + CODE + "```\n\nTail\n";
const PARAMS = { beta: 0.93, mode: "fast", on: true };
const CONTROLS = [
  { name: "beta", kind: "slider", min: 0, max: 1, step: 0.01, value: 0.93 },
  { name: "mode", kind: "select", choices: ["fast", "slow"], value: "fast" },
  { name: "on", kind: "checkbox", value: true },
];

// Requests, results and the target are built through casts so the file compiles against the types before and after the change.
type RunRequest = Parameters<CellRuns["run"]>[1];
const request = (patch: Record<string, unknown> = {}): RunRequest => ({ requestId: "r1", label: "c", code: CODE, language: PY, noteKey: "note-1", ...patch }) as unknown as RunRequest;
const okResult = (patch: Record<string, unknown> = {}): CellResult => ({ status: "ok", language: PY, text: "1.86", durationMs: 4, ...patch }) as unknown as CellResult;

interface FakeTarget { host: CellRunTarget; body: () => string; states: CellRunState[]; previews: CellResult[]; counts: { writes: number; pushes: number } }

function target(initial: string): FakeTarget {
  const state = { body: initial };
  const states: CellRunState[] = [];
  const previews: CellResult[] = [];
  const counts = { writes: 0, pushes: 0 };
  const host = {
    read: async () => state.body,
    write: async (next: string) => { state.body = next; counts.writes++; },
    push: () => { counts.pushes++; },
    post: (value: CellRunState) => { states.push(value); },
    fail: () => undefined,
    preview: (result: CellResult) => { previews.push(result); },
  } as unknown as CellRunTarget;
  return { host, body: () => state.body, states, previews, counts };
}

const portReturning = (result: CellResult): { port: RunCellPort; seen: unknown[] } => {
  const seen: unknown[] = [];
  return { seen, port: async (req) => { seen.push(req); return result; } };
};

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = <A extends unknown[]>(body: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
  try {
    await body(...args);
  } catch (error) {
    throw new Error(`not implemented: cell params, previews and controls (${error instanceof Error ? error.message : String(error)})`);
  }
};

describe("createCellRuns previews", () => {
  it("2.1a a preview run calls preview with the result and never write or push", behaviour(async () => {
    const host = target(BODY);
    const result = okResult({ controls: CONTROLS });
    await createCellRuns().run(portReturning(result).port, request({ params: PARAMS, preview: true }), host.host);
    expect(host.previews).toHaveLength(1);
    expect(host.previews[0]).toEqual(result);
    expect(host.counts.writes).toBe(0);
    expect(host.counts.pushes).toBe(0);
    expect(host.body()).toBe(BODY);
  }));

  it("2.1a a preview run posts running then the end state", behaviour(async () => {
    const host = target(BODY);
    await createCellRuns().run(portReturning(okResult()).port, request({ params: PARAMS, preview: true }), host.host);
    expect(host.previews).toHaveLength(1);
    expect(host.states).toEqual(["running", "done"]);
  }));

  it("2.1a a preview run passes the requested params to the runner", behaviour(async () => {
    const host = target(BODY);
    const { port, seen } = portReturning(okResult());
    await createCellRuns().run(port, request({ params: PARAMS, preview: true }), host.host);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: CODE, language: PY, noteKey: "note-1", params: PARAMS });
  }));

  it("2.1a several previews in a row never write or push", behaviour(async () => {
    const host = target(BODY);
    const runs = createCellRuns();
    for (const beta of [0.1, 0.5, 0.9]) {
      await runs.run(portReturning(okResult()).port, request({ requestId: "p" + beta, params: { beta }, preview: true }), host.host);
    }
    expect(host.previews).toHaveLength(3);
    expect(host.counts).toEqual({ writes: 0, pushes: 0 });
    expect(host.body()).toBe(BODY);
  }));
});

describe("createCellRuns normal runs with params", () => {
  it("A3 previews write nothing; a normal run with params writes one output with the matching params attribute", behaviour(async () => {
    const host = target(BODY);
    const runs = createCellRuns();
    await runs.run(portReturning(okResult()).port, request({ requestId: "p1", params: { beta: 0.5 }, preview: true }), host.host);
    await runs.run(portReturning(okResult()).port, request({ requestId: "p2", params: { beta: 0.7 }, preview: true }), host.host);
    expect(host.counts).toEqual({ writes: 0, pushes: 0 });
    expect(findOutputs(host.body())).toHaveLength(0);

    await runs.run(portReturning(okResult()).port, request({ requestId: "n1", params: PARAMS }), host.host);
    expect(host.counts.writes).toBe(1);
    expect(host.counts.pushes).toBe(1);
    const outputs = findOutputs(host.body());
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.cell).toBe("c");
    expect(outputs[0]!.params).toBeDefined();
    expect(readOutputParams(outputs[0]!.params!)).toEqual(PARAMS);
    expect(host.previews).toHaveLength(2);
    expect(host.states).toEqual(["running", "done", "running", "done", "running", "done"]);
  }));

  it("A3 a normal run with params passes them to the runner", behaviour(async () => {
    const host = target(BODY);
    const { port, seen } = portReturning(okResult());
    await createCellRuns().run(port, request({ params: PARAMS }), host.host);
    expect(seen[0]).toMatchObject({ params: PARAMS });
  }));

  it("A3 a normal run without params writes an output without the params attribute", behaviour(async () => {
    const host = target(BODY);
    const runs = createCellRuns();
    await runs.run(portReturning(okResult()).port, request({ requestId: "p1", params: PARAMS, preview: true }), host.host);
    expect(host.previews).toHaveLength(1);
    await runs.run(portReturning(okResult()).port, request({ requestId: "n1" }), host.host);
    const outputs = findOutputs(host.body());
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.params).toBeUndefined();
  }));

  it("A3 a normal run with params replaces the output of the earlier run with the new params attribute", behaviour(async () => {
    const host = target(BODY);
    const runs = createCellRuns();
    await runs.run(portReturning(okResult()).port, request({ requestId: "n1", params: { beta: 0.2 } }), host.host);
    await runs.run(portReturning(okResult()).port, request({ requestId: "n2", params: { beta: 0.8 } }), host.host);
    const outputs = findOutputs(host.body());
    expect(outputs).toHaveLength(1);
    expect(readOutputParams(outputs[0]!.params!)).toEqual({ beta: 0.8 });
  }));
});

// A fake driver speaking the D3 protocol: it answers `echo` with the raw request line it received and `controls` with a controls array.
const DRIVER_SOURCE = String.raw`
const readline = require("node:readline");
const SENT = "\u0001LABSHELF\u0001";
const reply = (obj) => process.stdout.write(SENT + JSON.stringify(obj) + "\n");
const controls = ${JSON.stringify(CONTROLS)};
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  const cmd = String(req.code).trim();
  if (cmd === "raw") { reply({ id: req.id, text: line }); }
  else if (cmd === "controls") { reply({ id: req.id, text: "frame", controls }); }
  else { reply({ id: req.id, text: "plain" }); }
});
rl.on("close", () => process["exit"](0));
`;

describe("createCellSessions params and controls", () => {
  let workDir = "";
  let driverPath = "";
  const live: Array<ReturnType<typeof createCellSessions>> = [];
  let current: ReturnType<typeof createCellSessions> | undefined;

  beforeAll(async () => {
    workDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-protocol-")));
    driverPath = path.join(workDir, "driver.js");
    await fs.writeFile(driverPath, DRIVER_SOURCE, "utf8");
  });

  afterEach(async () => {
    current = undefined;
    await Promise.all(live.splice(0, live.length).map((sessions) => sessions.dispose().catch(() => undefined)));
  });

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  const run = async (code: string, extra: Record<string, unknown> = {}): Promise<CellResult> => {
    // One session per test, so later runs of a test reach the same driver.
    const sessions = current ?? createCellSessions({
      logger: fakeLogger(),
      launch: async () => ({ command: process.execPath, args: [driverPath] }),
    });
    if (!current) { current = sessions; live.push(sessions); }
    const req = { code, language: PY, noteKey: "note-a", ...extra } as unknown as Parameters<typeof sessions.run>[0];
    return sessions.run(req, { cwd: workDir, signal: new AbortController().signal, timeoutMs: 10_000 });
  };

  it("2.1b params reach the driver request line", behaviour(async () => {
    const result = await run("raw", { params: PARAMS });
    expect(result.status).toBe("ok");
    const line = JSON.parse(result.text!) as Record<string, unknown>;
    expect(line.code).toBe("raw");
    expect(typeof line.id).toBe("number");
    expect(line.params).toEqual(PARAMS);
  }));

  it("2.1b the request line omits params when the params are empty", behaviour(async () => {
    const withParams = JSON.parse((await run("raw", { params: PARAMS })).text!) as Record<string, unknown>;
    expect(withParams.params).toEqual(PARAMS);
    const result = await run("raw", { params: {} });
    expect(result.status).toBe("ok");
    const line = JSON.parse(result.text!) as Record<string, unknown>;
    expect(line).not.toHaveProperty("params");
    expect(line.code).toBe("raw");
  }));

  it("2.1b the request line omits params when the request has none", behaviour(async () => {
    const withParams = JSON.parse((await run("raw", { params: PARAMS })).text!) as Record<string, unknown>;
    expect(withParams.params).toEqual(PARAMS);
    const result = await run("raw");
    const line = JSON.parse(result.text!) as Record<string, unknown>;
    expect(line).not.toHaveProperty("params");
  }));

  it("2.1b controls in a driver response reach the CellResult", behaviour(async () => {
    const result = await run("controls", { params: { beta: 0.93 } });
    expect(result.status).toBe("ok");
    expect(result.text).toBe("frame");
    expect((result as { controls?: unknown }).controls).toEqual(CONTROLS);
  }));

  it("2.1b a response without controls gives a result without controls", behaviour(async () => {
    expect((await run("controls") as { controls?: unknown }).controls).toEqual(CONTROLS);
    const result = await run("plain");
    expect(result.status).toBe("ok");
    expect((result as { controls?: unknown }).controls).toBeUndefined();
  }));
});
