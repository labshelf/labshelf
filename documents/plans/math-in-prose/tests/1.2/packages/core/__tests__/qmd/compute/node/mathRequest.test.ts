/** Verifies ICellRunner.runMath of createCellSessions against a fake Mathematica driver: the request line, its place in the note's queue, the reply parsed into a MathResult, and that an abort never kills the session. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CellLanguage } from "../../../../src/qmd/compute/cellLanguage";
import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createCellSessions, type DriverLaunch } from "../../../../src/qmd/compute/node/cellSessions";
import { fakeLogger } from "../../../support/fakeLogger";

jest.setTimeout(30_000);

const MATH = "mathematica" as CellLanguage;

// Fake driver: logs every line it receives (at arrival) and every reply it sends to LABSHELF_REQ_LOG. Cell lines {id, code}: "sleep N", "pid". Math lines {id, math}: tex containing "slow" waits 400 ms first; tex containing "differs" answers a full differs reply; otherwise proved.
const DRIVER_SOURCE = String.raw`
const readline = require("node:readline");
const fs = require("node:fs");
const SENT = "\u0001LABSHELF\u0001";
const log = (obj) => fs.appendFileSync(process.env.LABSHELF_REQ_LOG, JSON.stringify(obj) + "\n");
function reply(obj) { log({ ev: "reply", id: obj.id }); process.stdout.write(SENT + JSON.stringify(obj) + "\n"); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function handle(line) {
  const req = JSON.parse(line);
  if (req.math !== undefined) {
    if (String(req.math.tex).includes("slow")) { await sleep(400); }
    if (String(req.math.tex).includes("differs")) {
      reply({ id: req.id, math: { state: "differs", readAs: "Plus[x, 1]", messages: ["note one"], counterexample: { point: { x: 2 }, lhs: "3", rhs: "4" }, rewrites: ["leibniz"] } });
    } else {
      reply({ id: req.id, math: { state: "proved", readAs: "Exp[x]", rewrites: ["leibniz"] } });
    }
    return;
  }
  const words = String(req.code).trim().split(" ");
  if (words[0] === "sleep") { await sleep(Number(words[1])); reply({ id: req.id, text: "slept" }); }
  else if (words[0] === "pid") { reply({ id: req.id, text: String(process.pid) }); }
  else { reply({ id: req.id, text: "ok" }); }
}
let chain = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => { log({ ev: "recv", line }); chain = chain.then(() => handle(line)); });
rl.on("close", () => process["exit"](0));
`;

// runMath as the tests use it; typed locally so the file also compiles if the port declares runMath optional.
interface MathResultShape { state: string; readAs?: string; rewrites: string[]; messages: string[]; counterexample?: { point: Record<string, number>; lhs: string; rhs: string } }
type MathRunner = ICellRunner & { runMath(request: { noteKey: string; op: "eval" | "numeric" | "solve" | "check"; tex: string }, signal?: AbortSignal): Promise<MathResultShape> };

interface LogEntry { ev: "recv" | "reply"; line?: string; id?: number }

let workDir = "";
let driverPath = "";
let logPath = "";
const live: ICellRunner[] = [];

beforeEach(async () => {
  workDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-math-")));
  driverPath = path.join(workDir, "driver.js");
  logPath = path.join(workDir, "requests.log");
  await fs.writeFile(driverPath, DRIVER_SOURCE, "utf8");
  await fs.writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await Promise.all(live.splice(0, live.length).map((sessions) => sessions.dispose().catch(() => undefined)));
  await fs.rm(workDir, { recursive: true, force: true });
});

function makeSessions(options: { missing?: boolean } = {}): { sessions: MathRunner; launches: CellLanguage[] } {
  const launches: CellLanguage[] = [];
  const sessions = createCellSessions({
    logger: fakeLogger(),
    launch: async (language): Promise<DriverLaunch | undefined> => {
      launches.push(language);
      if (options.missing) { return undefined; }
      return { command: process.execPath, args: [driverPath], env: { LABSHELF_REQ_LOG: logPath } };
    },
  });
  live.push(sessions);
  if (typeof (sessions as Partial<MathRunner>).runMath !== "function") { throw new Error("not implemented: 1.2 runMath"); }
  return { sessions: sessions as MathRunner, launches };
}

const runCell = (sessions: ICellRunner, code: string, noteKey = "note-a") =>
  sessions.run({ code, language: MATH, noteKey }, { cwd: workDir, signal: new AbortController().signal, timeoutMs: 10_000 });

async function readLog(): Promise<LogEntry[]> {
  const text = await fs.readFile(logPath, "utf8");
  return text.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as LogEntry);
}

const mathLines = (entries: LogEntry[]): Array<Record<string, unknown>> =>
  entries.filter((entry) => entry.ev === "recv").map((entry) => JSON.parse(entry.line ?? "{}") as Record<string, unknown>).filter((line) => line.math !== undefined);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForMathLine(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (mathLines(await readLog()).length > 0) { return; }
    await delay(10);
  }
  throw new Error("the driver never received a math line");
}

describe("runMath request", () => {
  test("1.2a a math request reaches the driver as one {id, math: {op, tex}} line with the normalised TeX", async () => {
    const { sessions } = makeSessions();
    await sessions.runMath({ noteKey: "note-a", op: "eval", tex: "e^{x}" });
    const lines = mathLines(await readLog());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ id: expect.any(Number), math: { op: "eval", tex: "\\exp\\left(x\\right)" } });
  });

  test("1.2a the op travels as given", async () => {
    const { sessions } = makeSessions();
    await sessions.runMath({ noteKey: "note-a", op: "check", tex: "x+1=1+x" });
    const lines = mathLines(await readLog());
    expect(lines[0]).toEqual({ id: expect.any(Number), math: { op: "check", tex: "x+1=1+x" } });
  });

  test("1.2a a math request waits for an earlier queued cell of the same noteKey", async () => {
    const { sessions, launches } = makeSessions();
    const cell = runCell(sessions, "sleep 250");
    const math = sessions.runMath({ noteKey: "note-a", op: "eval", tex: "x+x" });
    await Promise.all([cell, math]);
    const entries = await readLog();
    const received = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.ev === "recv");
    const cellRecv = received.find(({ entry }) => (JSON.parse(entry.line ?? "{}") as { code?: string }).code !== undefined);
    const mathRecv = received.find(({ entry }) => (JSON.parse(entry.line ?? "{}") as { math?: unknown }).math !== undefined);
    expect(cellRecv).toBeDefined();
    expect(mathRecv).toBeDefined();
    const cellId = (JSON.parse(cellRecv?.entry.line ?? "{}") as { id: number }).id;
    const cellReply = entries.findIndex((entry) => entry.ev === "reply" && entry.id === cellId);
    expect(cellRecv!.index).toBeLessThan(cellReply);
    expect(cellReply).toBeLessThan(mathRecv!.index);
    expect(launches).toEqual([MATH]);
  });

  test("1.2a a math request of another noteKey does not wait for the cell and gets its own session", async () => {
    const { sessions, launches } = makeSessions();
    const cell = runCell(sessions, "sleep 600", "note-a");
    const started = Date.now();
    await sessions.runMath({ noteKey: "note-b", op: "eval", tex: "x" });
    expect(Date.now() - started).toBeLessThan(500);
    await cell;
    expect(launches).toEqual([MATH, MATH]);
  });

  test("1.2a a math request on a note with no session starts a mathematica one and shares it with later cells", async () => {
    const { sessions, launches } = makeSessions();
    await sessions.runMath({ noteKey: "note-a", op: "eval", tex: "x" });
    await runCell(sessions, "pid");
    expect(launches).toEqual([MATH]);
  });

  test("1.2a without Mathematica the result is failed with a message", async () => {
    const { sessions } = makeSessions({ missing: true });
    const result = await sessions.runMath({ noteKey: "note-a", op: "eval", tex: "x" });
    expect(result.state).toBe("failed");
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]).not.toBe("");
  });
});

describe("runMath reply", () => {
  test("1.2b a proved reply becomes a MathResult with state, readAs and the normaliser's rewrites", async () => {
    const { sessions } = makeSessions();
    const result = await sessions.runMath({ noteKey: "note-a", op: "check", tex: "e^{x}" });
    expect(result.state).toBe("proved");
    expect(result.readAs).toBe("Exp[x]");
    expect(result.rewrites).toEqual(["euler-e"]);
    expect(result.messages).toEqual([]);
  });

  test("1.2b the rewrites come from the normaliser, not from the driver reply", async () => {
    const { sessions } = makeSessions();
    const result = await sessions.runMath({ noteKey: "note-a", op: "check", tex: "x+x" });
    expect(result.state).toBe("proved");
    expect(result.rewrites).toEqual([]);
  });

  test("1.2b a differs reply carries its counterexample and messages", async () => {
    const { sessions } = makeSessions();
    const result = await sessions.runMath({ noteKey: "note-a", op: "check", tex: "differs" });
    expect(result.state).toBe("differs");
    expect(result.counterexample).toEqual({ point: { x: 2 }, lhs: "3", rhs: "4" });
    expect(result.messages).toEqual(["note one"]);
    expect(result.rewrites).toEqual([]);
  });
});

describe("runMath abort", () => {
  test("1.2c an abort after the request was sent does not kill the session", async () => {
    const { sessions, launches } = makeSessions();
    const before = Number((await runCell(sessions, "pid")).text);
    const controller = new AbortController();
    const math = sessions.runMath({ noteKey: "note-a", op: "check", tex: "slow" }, controller.signal);
    await waitForMathLine();
    controller.abort();
    await Promise.allSettled([math]);
    const after = await runCell(sessions, "pid");
    expect(after.status).toBe("ok");
    expect(Number(after.text)).toBe(before);
    expect(after.restarted).toBeUndefined();
    expect(launches).toEqual([MATH]);
  });

  test("1.2c the next cell request waits for the aborted math reply and runs in the same process", async () => {
    const { sessions } = makeSessions();
    const before = Number((await runCell(sessions, "pid")).text);
    const controller = new AbortController();
    void sessions.runMath({ noteKey: "note-a", op: "check", tex: "slow" }, controller.signal);
    await waitForMathLine();
    controller.abort();
    const after = await runCell(sessions, "pid");
    expect(Number(after.text)).toBe(before);
  });

  test("1.2c an abort while the request is still queued drops it before it is sent", async () => {
    const { sessions } = makeSessions();
    const cell = runCell(sessions, "sleep 300");
    const controller = new AbortController();
    const math = sessions.runMath({ noteKey: "note-a", op: "eval", tex: "x" }, controller.signal);
    controller.abort();
    await Promise.allSettled([math]);
    await cell;
    const after = await runCell(sessions, "pid");
    expect(after.status).toBe("ok");
    expect(mathLines(await readLog())).toHaveLength(0);
  });
});
