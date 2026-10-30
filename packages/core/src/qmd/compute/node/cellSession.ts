// One persistent driver process for one (note key, language): spawn with the ready handshake, output capture, one request at a time, kill, idle close.
import { spawn, type ChildProcess } from "node:child_process";

import { createKillSwitch, type KillSwitch } from "../../../latex/node/index.js";
import type { CellStatus } from "../cellRunner.js";
import { SENTINEL, isReadyLine, lineReader, parseResponse, type Outcome } from "./cellDriverProtocol.js";

const KILL_GRACE_MS = 2_000;
const STDERR_TAIL_LINES = 20;
/** How long a session waits for its pipes to close after the process exits before it settles. */
const CLOSE_WAIT_MS = 200;

/** `ready`: the driver writes one sentinel line `{"ready": true}` after its startup; output before it goes to the logger, not to a cell. */
export interface DriverLaunch { command: string; args: string[]; env?: Record<string, string>; ready?: boolean }

export type SessionNote = (message: string, data?: Record<string, unknown>) => void;

export interface SessionContext { readonly key: string; readonly note: SessionNote }

export interface SessionHooks extends SessionContext {
  /** Called each time the session is dropped, by a kill or by the process ending. */
  onDrop(session: Session): void;
  /** Called when the process ended without a kill. */
  onEndedOnItsOwn(): void;
}

interface Pending { id: number; output: string[]; settle: (outcome: Outcome) => void }

export interface Session {
  readonly child: ChildProcess;
  /** Resolves once the process is gone and the session has settled. */
  readonly gone: Promise<void>;
  pending: Pending | undefined;
  idleTimer: NodeJS.Timeout | undefined;
  /** Set once the session is dropped, by a kill or by the process ending. */
  dead: boolean;
  /** Ends the in-flight run with `status` and kills the process tree. */
  kill(status: CellStatus): void;
}

interface StreamState {
  /** Without the handshake every line belongs to the running cell from the start. */
  ready: boolean;
  readonly stderrTail: string[];
}

function spawnDriver(launch: DriverLaunch, cwd: string): ChildProcess {
  // PLATFORM: detached makes the driver a group leader on POSIX so a kill reaches its children; on Windows killTree uses taskkill /T.
  return spawn(launch.command, launch.args, {
    cwd,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", ...launch.env },
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
}

function settlePending(session: Session, outcome: Outcome): void {
  const pending = session.pending;
  if (!pending) { return; }
  session.pending = undefined;
  pending.settle(outcome);
}

function dropSession(session: Session, hooks: SessionHooks): void {
  session.dead = true;
  clearTimeout(session.idleTimer);
  hooks.onDrop(session);
}

function logStartup(context: SessionContext, stream: string, line: string): void {
  context.note("Cell driver output before it was ready", { key: context.key, stream, line });
}

function readStdout(session: Session, state: StreamState, context: SessionContext): ReturnType<typeof lineReader> {
  return lineReader((line) => {
    const pending = session.pending;
    if (!state.ready) {
      // Lines of the other stream written just before the ready line may still be in flight; give them one turn.
      if (line.startsWith(SENTINEL) && isReadyLine(line)) { setImmediate(() => { state.ready = true; }); return; }
      // A response means the driver is up, so only plain lines are startup noise.
      if (!line.startsWith(SENTINEL)) { logStartup(context, "stdout", line); return; }
    }
    if (line.startsWith(SENTINEL)) {
      const response = parseResponse(line);
      if (response && pending && response.id === pending.id) {
        // Lines of the other stream written just before the response may still be in flight; give them one turn.
        setImmediate(() => { if (session.pending === pending) { settlePending(session, { kind: "response", response, output: pending.output }); } });
        return;
      }
      if (response) { return; }
    }
    pending?.output.push(line);
  });
}

function readStderr(session: Session, state: StreamState, context: SessionContext): ReturnType<typeof lineReader> {
  return lineReader((line) => {
    state.stderrTail.push(line);
    if (state.stderrTail.length > STDERR_TAIL_LINES) { state.stderrTail.shift(); }
    if (!state.ready) { logStartup(context, "stderr", line); return; }
    session.pending?.output.push(line);
  });
}

/** Calls `finish` with the reason once the process failed to start or exited and its pipes closed (or did not close in time). */
function watchEnd(child: ChildProcess, finish: (reason: string) => void): void {
  child.on("error", (error) => {
    finish(error.message);
  });
  child.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `exit code ${String(code)}`;
    const wait = setTimeout(() => finish(reason), CLOSE_WAIT_MS);
    wait.unref();
    child.once("close", () => { clearTimeout(wait); finish(reason); });
  });
}

function endSession(session: Session, hooks: SessionHooks, reason: string, stderrTail: string[]): void {
  if (!session.dead) {
    hooks.onEndedOnItsOwn();
    hooks.note("The cell driver ended on its own", { key: hooks.key, reason });
  }
  dropSession(session, hooks);
  const tail = stderrTail.join("\n").trim();
  settlePending(session, { kind: "ended", status: "error", error: tail ? `The cell driver ended (${reason}): ${tail}` : `The cell driver ended (${reason})`, output: session.pending?.output ?? [] });
}

export function startSession(launch: DriverLaunch, cwd: string, hooks: SessionHooks): Session {
  const child = spawnDriver(launch, cwd);
  let killSwitch: KillSwitch | undefined;
  let resolveGone: () => void = () => undefined;
  const gone = new Promise<void>((resolve) => { resolveGone = resolve; });
  const session: Session = {
    child,
    gone,
    pending: undefined,
    idleTimer: undefined,
    dead: false,
    kill(status) {
      const pending = session.pending;
      if (pending) { settlePending(session, { kind: "ended", status, output: pending.output }); }
      dropSession(session, hooks);
      killSwitch ??= createKillSwitch(child, { timeoutMs: undefined, graceMs: KILL_GRACE_MS, note: (message) => hooks.note(message, { key: hooks.key }) });
      killSwitch.terminate();
    },
  };
  const state: StreamState = { ready: !launch.ready, stderrTail: [] };
  const onStdout = readStdout(session, state, hooks);
  const onStderr = readStderr(session, state, hooks);
  child.stdout?.on("data", onStdout.push);
  child.stderr?.on("data", onStderr.push);
  child.stdin?.on("error", () => undefined);
  let finished = false;
  watchEnd(child, (reason) => {
    if (finished) { return; }
    finished = true;
    onStdout.flush();
    onStderr.flush();
    killSwitch?.close();
    endSession(session, hooks, reason, state.stderrTail);
    resolveGone();
  });
  return session;
}

export interface RequestOptions { readonly signal: AbortSignal; readonly timeoutMs: number }

/** Writes one request and resolves with its response, or with the end of the session on a cancel, a timeout or the process ending. */
export function sendRequest(session: Session, id: number, code: string, params: Record<string, number | string | boolean> | undefined, opts: RequestOptions, context: SessionContext): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const onAbort = (): void => { session.kill("cancelled"); };
    session.pending = {
      id,
      output: [],
      settle: (result) => {
        clearTimeout(timer);
        opts.signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
    };
    opts.signal.addEventListener("abort", onAbort, { once: true });
    session.child.stdin?.write(`${JSON.stringify(params !== undefined && Object.keys(params).length > 0 ? { id, code, params } : { id, code })}\n`);
    timer = setTimeout(() => {
      context.note("A cell timed out; killing its driver", { key: context.key, timeoutMs: opts.timeoutMs });
      session.kill("timeout");
    }, opts.timeoutMs);
  });
}

/** (Re)starts the idle timer: after `idleMs` without a run the session is killed; `onIdle` runs just before the kill. */
export function armIdle(session: Session, idleMs: number, context: SessionContext, onIdle: () => void): void {
  clearTimeout(session.idleTimer);
  if (session.dead) { return; }
  session.idleTimer = setTimeout(() => {
    if (session.dead || session.pending) { return; }
    context.note("Closing an idle cell driver", { key: context.key });
    onIdle();
    session.kill("cancelled");
  }, idleMs);
  session.idleTimer.unref();
}
