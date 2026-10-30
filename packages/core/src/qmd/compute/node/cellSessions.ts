// Runs code cells in one persistent driver process per (note key, language): JSON request lines go to stdin, a sentinel-framed JSON line comes back.
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { createKillSwitch, type KillSwitch } from "../../../latex/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { CellLanguage } from "../cellLanguage.js";
import type { CellResult, CellStatus, ICellRunner } from "../cellRunner.js";

const MODULE_SESSIONS = "qmd/cellSessions";
const SENTINEL = "\u0001LABSHELF\u0001";
const DEFAULT_IDLE_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 2_000;
const STDERR_TAIL_LINES = 20;
/** How long a session waits for its pipes to close after the process exits before it settles. */
const CLOSE_WAIT_MS = 200;

export interface DriverLaunch { command: string; args: string[]; env?: Record<string, string> }

export interface CellSessionsOptions { launch(language: CellLanguage): Promise<DriverLaunch | undefined>; idleMs?: number; now?: () => number; logger?: ILogger }

interface DriverResponse { id: number; latex?: string; text?: string; error?: string }

type Outcome = { kind: "response"; response: DriverResponse; output: string[] } | { kind: "ended"; status: CellStatus; error?: string; output: string[] };

interface Pending { id: number; output: string[]; settle: (outcome: Outcome) => void }

interface Session {
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
  pending: Pending | undefined;
  idleTimer: NodeJS.Timeout | undefined;
  /** Set once the session is dropped, by a kill or by the process ending. */
  dead: boolean;
  /** Ends the in-flight run with `status` and kills the process tree. */
  kill(status: CellStatus): void;
}

function parseResponse(line: string): DriverResponse | undefined {
  try {
    const parsed: unknown = JSON.parse(line.slice(SENTINEL.length));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) { return undefined; }
    const id = (parsed as { id?: unknown }).id;
    return typeof id === "number" ? parsed as DriverResponse : undefined;
  } catch {
    return undefined;
  }
}

/** Splits a stream into lines on CRLF or LF, with no cap on the line length. */
function lineReader(onLine: (line: string) => void): { push: (chunk: Buffer) => void; flush: () => void } {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  const take = (text: string): void => {
    const parts = (rest + text).split(/\r?\n/);
    rest = parts.pop() ?? "";
    for (const part of parts) { onLine(part); }
  };
  return {
    push: (chunk) => take(decoder.write(chunk)),
    flush: () => {
      take(decoder.end());
      if (rest) { const last = rest.replace(/\r$/, ""); rest = ""; onLine(last); }
    },
  };
}

function toResult(outcome: Outcome, language: CellLanguage, durationMs: number): CellResult {
  const printed = outcome.output.join("\n");
  if (outcome.kind === "ended") {
    return { status: outcome.status, language, ...(outcome.error !== undefined ? { error: outcome.error } : {}), ...(printed ? { text: printed } : {}), durationMs };
  }
  const { response } = outcome;
  const text = [printed, response.error === undefined ? response.text : undefined].filter((part): part is string => part !== undefined && part !== "").join("\n");
  if (response.error !== undefined) {
    return { status: "error", language, error: response.error, ...(text ? { text } : {}), durationMs };
  }
  return {
    status: "ok",
    language,
    ...(response.latex !== undefined ? { latex: response.latex } : {}),
    ...(text || response.text !== undefined ? { text } : {}),
    durationMs,
  };
}

export function createCellSessions(options: CellSessionsOptions): ICellRunner {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const chains = new Map<string, Promise<unknown>>();
  /** Keys whose last process was killed (cancel, timeout, restart, idle close) or died; the next spawn on them reports restarted, the first spawn on a key does not. */
  const restartedKeys = new Set<string>();
  let nextId = 1;
  let disposed = false;

  const note = (message: string, data?: Record<string, unknown>): void => {
    void options.logger?.log("INFO", MODULE_SESSIONS, message, data).catch(() => undefined);
  };
  const keyOf = (noteKey: string, language: CellLanguage): string => `${language}\u0000${noteKey}`;

  const drop = (key: string, session: Session): void => {
    session.dead = true;
    clearTimeout(session.idleTimer);
    if (sessions.get(key) === session) { sessions.delete(key); }
  };

  function startSession(key: string, launch: DriverLaunch, cwd: string): Session {
    // PLATFORM: detached makes the driver a group leader on POSIX so a kill reaches its children; on Windows killTree uses taskkill /T.
    const child = spawn(launch.command, launch.args, {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const stderrTail: string[] = [];
    let killSwitch: KillSwitch | undefined;
    let resolveExited: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => { resolveExited = resolve; });

    const settlePending = (outcome: Outcome): void => {
      const pending = session.pending;
      if (!pending) { return; }
      session.pending = undefined;
      pending.settle(outcome);
    };

    const session: Session = {
      child,
      exited,
      pending: undefined,
      idleTimer: undefined,
      dead: false,
      kill(status) {
        const pending = session.pending;
        if (pending) { settlePending({ kind: "ended", status, output: pending.output }); }
        drop(key, session);
        killSwitch ??= createKillSwitch(child, { timeoutMs: undefined, graceMs: KILL_GRACE_MS, note: (message) => note(message, { key }) });
        killSwitch.terminate();
      },
    };

    const onStdout = lineReader((line) => {
      const pending = session.pending;
      if (line.startsWith(SENTINEL)) {
        const response = parseResponse(line);
        if (response && pending && response.id === pending.id) {
          // Lines of the other stream written just before the response may still be in flight; give them one turn.
          setImmediate(() => { if (session.pending === pending) { settlePending({ kind: "response", response, output: pending.output }); } });
          return;
        }
        if (response) { return; }
      }
      pending?.output.push(line);
    });
    const onStderr = lineReader((line) => {
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_LINES) { stderrTail.shift(); }
      session.pending?.output.push(line);
    });
    child.stdout?.on("data", onStdout.push);
    child.stderr?.on("data", onStderr.push);
    child.stdin?.on("error", () => undefined);

    let finished = false;
    const finish = (reason: string): void => {
      if (finished) { return; }
      finished = true;
      onStdout.flush();
      onStderr.flush();
      killSwitch?.close();
      if (!session.dead) {
        restartedKeys.add(key);
        note("The cell driver ended on its own", { key, reason });
      }
      drop(key, session);
      const tail = stderrTail.join("\n").trim();
      settlePending({ kind: "ended", status: "error", error: tail ? `The cell driver ended (${reason}): ${tail}` : `The cell driver ended (${reason})`, output: session.pending?.output ?? [] });
      resolveExited();
    };
    child.on("error", (error) => {
      finish(error.message);
    });
    child.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit code ${String(code)}`;
      const wait = setTimeout(() => finish(reason), CLOSE_WAIT_MS);
      wait.unref();
      child.once("close", () => { clearTimeout(wait); finish(reason); });
    });
    return session;
  }

  const armIdle = (key: string, session: Session): void => {
    clearTimeout(session.idleTimer);
    if (session.dead) { return; }
    session.idleTimer = setTimeout(() => {
      if (session.dead || session.pending) { return; }
      note("Closing an idle cell driver", { key });
      restartedKeys.add(key);
      session.kill("cancelled");
    }, idleMs);
    session.idleTimer.unref();
  };

  const runner: ICellRunner = {
    run({ code, language, noteKey }, opts) {
      const started = now();
      const elapsed = (): number => now() - started;
      const key = keyOf(noteKey, language);
      const task = async (): Promise<CellResult> => {
        if (opts.signal.aborted || disposed) { return { status: "cancelled", language, durationMs: elapsed() }; }
        let session = sessions.get(key);
        let restarted = false;
        if (session) {
          clearTimeout(session.idleTimer);
        } else {
          const launch = await options.launch(language);
          if (!launch) { return { status: "missing", language, durationMs: elapsed() }; }
          if (opts.signal.aborted || disposed) { return { status: "cancelled", language, durationMs: elapsed() }; }
          session = startSession(key, launch, opts.cwd);
          sessions.set(key, session);
          restarted = restartedKeys.delete(key);
        }
        const live = session;
        const id = nextId++;
        const outcome = await new Promise<Outcome>((resolve) => {
          let timer: NodeJS.Timeout | undefined;
          const onAbort = (): void => { live.kill("cancelled"); };
          live.pending = {
            id,
            output: [],
            settle: (result) => {
              clearTimeout(timer);
              opts.signal.removeEventListener("abort", onAbort);
              resolve(result);
            },
          };
          opts.signal.addEventListener("abort", onAbort, { once: true });
          live.child.stdin?.write(`${JSON.stringify({ id, code })}\n`);
          timer = setTimeout(() => {
            note("A cell timed out; killing its driver", { key, timeoutMs: opts.timeoutMs });
            live.kill("timeout");
          }, opts.timeoutMs);
        });
        if (outcome.kind === "ended" && (outcome.status === "cancelled" || outcome.status === "timeout")) { restartedKeys.add(key); }
        armIdle(key, live);
        const result = toResult(outcome, language, elapsed());
        return restarted ? { ...result, restarted: true } : result;
      };
      const previous = chains.get(key) ?? Promise.resolve();
      const current = previous.then(task, task);
      const tail = current.catch(() => undefined);
      chains.set(key, tail);
      void tail.then(() => { if (chains.get(key) === tail) { chains.delete(key); } });
      return current;
    },

    async restart(noteKey, language) {
      const key = keyOf(noteKey, language);
      const session = sessions.get(key);
      if (!session) { return; }
      restartedKeys.add(key);
      session.kill("cancelled");
      await session.exited;
    },

    async dispose() {
      disposed = true;
      const all = [...sessions.values()];
      for (const session of all) { session.kill("cancelled"); }
      await Promise.all(all.map((session) => session.exited));
    },
  };
  return runner;
}
