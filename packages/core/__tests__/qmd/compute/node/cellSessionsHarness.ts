/** Shared harness of the createCellSessions tests: a fake driver speaking the D3 protocol, a temp working directory, session factories and process probes. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CellLanguage } from "../../../../src/qmd/compute/cellLanguage";
import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createCellSessions, type DriverLaunch } from "../../../../src/qmd/compute/node/cellSessions";
import { fakeLogger } from "../../../support/fakeLogger";

export type RunResult = Awaited<ReturnType<ICellRunner["run"]>>;

export const PY = "python" as CellLanguage;
export const R = "r" as CellLanguage;
export const MATH = "mathematica" as CellLanguage;

// The fake driver speaks the D3 protocol: JSON lines {id, code} in, "\u0001LABSHELF\u0001" + JSON {id, text|latex|error} out, exit on stdin EOF.
const DRIVER_SOURCE = String.raw`
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const SENT = "\u0001LABSHELF\u0001";
const vars = {};
let eol = "\n";
function reply(obj) { process.stdout.write(SENT + JSON.stringify(obj) + eol); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function handle(line) {
  const req = JSON.parse(line);
  const id = req.id;
  const words = String(req.code).trim().split(" ");
  const cmd = words[0];
  const rest = words.slice(1);
  if (cmd === "set") { vars[rest[0]] = rest[1]; reply({ id, text: "set" }); }
  else if (cmd === "get") { reply({ id, text: vars[rest[0]] === undefined ? "undefined" : vars[rest[0]] }); }
  else if (cmd === "echo") { reply({ id, text: rest.join(" ") }); }
  else if (cmd === "print") { process.stdout.write(rest.join(" ") + eol); reply({ id, text: "done" }); }
  else if (cmd === "printerr") { process.stderr.write(rest.join(" ") + "\n"); reply({ id, text: "done" }); }
  else if (cmd === "crlf") { eol = "\r\n"; process.stdout.write("crlfline" + eol); reply({ id, text: "done" }); }
  else if (cmd === "sleep") { await sleep(Number(rest[0])); reply({ id, text: "slept" }); }
  else if (cmd === "pid") { reply({ id, text: String(process.pid) }); }
  else if (cmd === "cwd") { reply({ id, text: process.cwd() }); }
  else if (cmd === "env") { reply({ id, text: String(process.env[rest[0]]) }); }
  else if (cmd === "latex") { reply({ id, latex: rest.join(" ") }); }
  else if (cmd === "fail") { reply({ id, error: rest.join(" ") }); }
  else if (cmd === "child") {
    const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    reply({ id, text: String(c.pid) });
  }
  else if (cmd === "exit") { process.stderr.write("fatal: driver went away\n"); process["exit"](Number(rest[0])); }
  else { reply({ id, error: "unknown command " + cmd }); }
}
let chain = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => { chain = chain.then(() => handle(line)); });
rl.on("close", () => process["exit"](0));
`;

/** Paths set up by installDriverHooks before the tests of a file run. */
export const dirs = { workDir: "", driverPath: "", cwdDir: "" };
const live: ICellRunner[] = [];

/** Registers the hooks that write the fake driver into a temp folder, dispose every runner after each test and remove the folder at the end. */
export function installDriverHooks(): void {
  beforeAll(async () => {
    dirs.workDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-sessions-")));
    dirs.driverPath = path.join(dirs.workDir, "driver.js");
    await fs.writeFile(dirs.driverPath, DRIVER_SOURCE, "utf8");
    dirs.cwdDir = path.join(dirs.workDir, "cwd");
    await fs.mkdir(dirs.cwdDir);
  });

  afterEach(async () => {
    await Promise.all(live.splice(0, live.length).map((sessions) => sessions.dispose().catch(() => undefined)));
  });

  afterAll(async () => {
    await fs.rm(dirs.workDir, { recursive: true, force: true });
  });
}

/** Disposes `sessions` after the current test. */
export function track(sessions: ICellRunner): void {
  live.push(sessions);
}

export interface Harness { sessions: ICellRunner; launches: CellLanguage[] }

export function makeSessions(options: { idleMs?: number; launchDelayMs?: number; env?: Record<string, string>; missing?: CellLanguage[] } = {}): Harness {
  const launches: CellLanguage[] = [];
  const sessions = createCellSessions({
    ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
    logger: fakeLogger(),
    launch: async (language): Promise<DriverLaunch | undefined> => {
      launches.push(language);
      if (options.launchDelayMs) { await new Promise((resolve) => setTimeout(resolve, options.launchDelayMs)); }
      if (options.missing?.includes(language)) { return undefined; }
      return { command: process.execPath, args: [dirs.driverPath], ...(options.env ? { env: options.env } : {}) };
    },
  });
  track(sessions);
  return { sessions, launches };
}

export function run(sessions: ICellRunner, code: string, key = "note-a", language: CellLanguage = PY, extra: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<RunResult> {
  return sessions.run({ code, language, noteKey: key }, { cwd: dirs.cwdDir, signal: extra.signal ?? new AbortController().signal, timeoutMs: extra.timeoutMs ?? 10_000 });
}

export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function waitGone(pid: number, withinMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) { return true; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isAlive(pid);
}

export const pidOf = async (sessions: ICellRunner, key = "note-a", language: CellLanguage = PY): Promise<number> => Number((await run(sessions, "pid", key, language)).text);
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
