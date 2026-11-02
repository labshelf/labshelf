// Runs code cells and the math requests of a note in one persistent driver process per (note key, language): JSON request lines go to stdin, a sentinel-framed JSON line comes back.
import { tmpdir } from "node:os";

import { isRecord } from "../../../guards/index.js";
import type { ILogger } from "../../../ports/index.js";
import { normaliseTex, type TexRewrite } from "../../item/index.js";
import type { CellLanguage } from "../cellLanguage.js";
import type { CellResult, CellStatus, ICellRunner, MathOp, MathRequest, MathResult, MathState } from "../cellRunner.js";
import { toResult, type Outcome } from "./cellDriverProtocol.js";
import { armIdle, sendRequest, startSession, type DriverLaunch, type Session, type SessionHooks, type SessionNote } from "./cellSession.js";

export type { DriverLaunch } from "./cellSession.js";

const MODULE_SESSIONS = "qmd/cellSessions";
const DEFAULT_IDLE_MS = 10 * 60 * 1000;

export interface CellSessionsOptions { launch(language: CellLanguage): Promise<DriverLaunch | undefined>; idleMs?: number; now?: () => number; logger?: ILogger }

type RunRequest = Parameters<ICellRunner["run"]>[0];
type RunOptions = Parameters<ICellRunner["run"]>[1];

interface Registry {
  readonly options: CellSessionsOptions;
  readonly idleMs: number;
  readonly now: () => number;
  readonly note: SessionNote;
  readonly sessions: Map<string, Session>;
  readonly chains: Map<string, Promise<unknown>>;
  /** Keys whose last process was killed (cancel, timeout, restart, idle close) or died; the next spawn on them reports restarted, the first spawn on a key does not. */
  readonly restartedKeys: Set<string>;
  /** The working directory of the last cell run of each note, which a math request spawns its session in. */
  readonly cwds: Map<string, string>;
  nextId: number;
  disposed: boolean;
}

const MATHEMATICA: CellLanguage = "mathematica" as CellLanguage;

const keyOf = (noteKey: string, language: CellLanguage): string => `${language}\u0000${noteKey}`;

function hooksFor(registry: Registry, key: string): SessionHooks {
  return {
    key,
    note: registry.note,
    onDrop: (session) => { if (registry.sessions.get(key) === session) { registry.sessions.delete(key); } },
    onEndedOnItsOwn: () => { registry.restartedKeys.add(key); },
  };
}

/** The live session of `key`, spawning it when there is none; a status when the language is missing or the run was cancelled meanwhile. */
async function acquire(registry: Registry, key: string, language: CellLanguage, opts: RunOptions): Promise<{ session: Session; restarted: boolean } | CellStatus> {
  const existing = registry.sessions.get(key);
  if (existing) {
    clearTimeout(existing.idleTimer);
    return { session: existing, restarted: false };
  }
  const launch = await registry.options.launch(language);
  if (!launch) { return "missing"; }
  if (opts.signal.aborted || registry.disposed) { return "cancelled"; }
  const session = startSession(launch, opts.cwd, hooksFor(registry, key));
  registry.sessions.set(key, session);
  return { session, restarted: registry.restartedKeys.delete(key) };
}

/** `durationMs` is the driver round trip: the clock restarts when the request is sent, so the queue wait and the launch are not counted. */
async function runCell(registry: Registry, { code, language, noteKey, params, preview }: RunRequest, opts: RunOptions): Promise<CellResult> {
  let started = registry.now();
  const elapsed = (): number => registry.now() - started;
  const key = keyOf(noteKey, language);
  if (opts.signal.aborted || registry.disposed) { return { status: "cancelled", language, durationMs: elapsed() }; }
  const acquired = await acquire(registry, key, language, opts);
  if (typeof acquired === "string") { return { status: acquired, language, durationMs: elapsed() }; }
  const { session, restarted } = acquired;
  const hooks = hooksFor(registry, key);
  const withParams = params !== undefined && Object.keys(params).length > 0;
  const line = { code, ...(withParams ? { params } : {}), ...(preview === true ? { preview: true } : {}) };
  started = registry.now();
  const outcome = await sendRequest(session, registry.nextId++, line, opts, hooks);
  if (outcome.kind === "ended" && (outcome.status === "cancelled" || outcome.status === "timeout")) { registry.restartedKeys.add(key); }
  armIdle(session, registry.idleMs, hooks, () => { registry.restartedKeys.add(key); });
  const result = toResult(outcome, language, elapsed());
  return restarted ? { ...result, restarted: true } : result;
}

/** Runs `task` after every earlier run on `key`, whether they succeeded or not. */
function enqueue<T>(registry: Registry, key: string, task: () => Promise<T>): Promise<T> {
  const previous = registry.chains.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => undefined);
  registry.chains.set(key, tail);
  void tail.then(() => { if (registry.chains.get(key) === tail) { registry.chains.delete(key); } });
  return current;
}

// The math request of a note's Mathematica session: the normalised request line, the reply parsed into a MathResult, and the flow that queues it like a cell.

/** The host-side limit of one math request; past it the session is killed. */
const MATH_TIMEOUT_MS = 30_000;

const MISSING_TEXT = "Mathematica cells need Wolfram Engine or Mathematica with wolframscript.";
const TIMEOUT_TEXT = "The math request took longer than 30 seconds, so Mathematica was restarted.";
const CANCELLED_TEXT = "The math request was cancelled.";
const STATES: ReadonlySet<string> = new Set<MathState>(["value", "proved", "sampled", "differs", "conditional", "unread", "failed"]);

/** @returns the request line the driver reads, beside its id: `{math: {op, tex}}`. */
function mathRequestLine(op: MathOp, tex: string): { math: { op: MathOp; tex: string } } {
  return { math: { op, tex } };
}

const failed = (rewrites: TexRewrite[], message: string): MathResult => ({ state: "failed", rewrites, messages: [message] });

function readCounterexample(value: unknown): MathResult["counterexample"] {
  if (!isRecord(value) || !isRecord(value.point) || typeof value.lhs !== "string" || typeof value.rhs !== "string") { return undefined; }
  const point: Record<string, number> = {};
  for (const [name, coordinate] of Object.entries(value.point)) {
    if (typeof coordinate !== "number") { return undefined; }
    point[name] = coordinate;
  }
  return { point, lhs: value.lhs, rhs: value.rhs };
}

/** @returns the MathResult of a driver outcome; `rewrites` are the normaliser's, never the driver's. */
function parseMathReply(outcome: Outcome, rewrites: TexRewrite[]): MathResult {
  if (outcome.kind === "ended") {
    if (outcome.status === "timeout") { return failed(rewrites, TIMEOUT_TEXT); }
    if (outcome.status === "cancelled") { return failed(rewrites, CANCELLED_TEXT); }
    return failed(rewrites, outcome.error ?? "The Mathematica session ended.");
  }
  const { response } = outcome;
  if (response.error !== undefined) { return failed(rewrites, response.error); }
  const math = response.math;
  if (!isRecord(math) || typeof math.state !== "string" || !STATES.has(math.state)) { return failed(rewrites, "The Mathematica driver sent a reply the math request could not read."); }
  const counterexample = readCounterexample(math.counterexample);
  return {
    state: math.state as MathState,
    ...(typeof math.latex === "string" ? { latex: math.latex } : {}),
    ...(typeof math.readAs === "string" ? { readAs: math.readAs } : {}),
    rewrites,
    messages: Array.isArray(math.messages) ? math.messages.filter((message): message is string => typeof message === "string") : [],
    ...(counterexample ? { counterexample } : {}),
    ...(typeof math.condition === "string" ? { condition: math.condition } : {}),
  };
}

/** What runMath needs of the sessions; `exec` acquires the note's mathematica session, sends `line` within `opts.timeoutMs`; an abort of `opts.signal` before the send gives "cancelled" and one after it is ignored, re-arms the idle timer and notes a kill for the next request. */
interface MathPort {
  /** Runs `task` after every earlier run on the note's mathematica key, whether they succeeded or not. */
  enqueue(noteKey: string, task: () => Promise<MathResult>): Promise<MathResult>;
  exec(noteKey: string, line: { math: { op: MathOp; tex: string } }, opts: { signal: AbortSignal | undefined; timeoutMs: number }): Promise<{ outcome: Outcome; restarted: boolean } | "missing" | "cancelled">;
  readonly disposed: boolean;
}

/** Normalises and queues one math request. An abort while it is queued drops it before it is sent; after it was sent the abort is ignored. */
function runMath(port: MathPort, request: MathRequest, signal?: AbortSignal): Promise<MathResult> {
  const { tex, rewrites } = normaliseTex(request.tex);
  return port.enqueue(request.noteKey, async () => {
    if (signal?.aborted || port.disposed) { return failed(rewrites, CANCELLED_TEXT); }
    const sent = await port.exec(request.noteKey, mathRequestLine(request.op, tex), { signal, timeoutMs: MATH_TIMEOUT_MS });
    if (sent === "missing") { return failed(rewrites, MISSING_TEXT); }
    if (sent === "cancelled") { return failed(rewrites, CANCELLED_TEXT); }
    const result = parseMathReply(sent.outcome, rewrites);
    return sent.restarted ? { ...result, restarted: true } : result;
  });
}

/** Wires math requests to the note's mathematica key: the same queue, session and idle timer as its cells. */
function mathPort(registry: Registry): MathPort {
  return {
    get disposed() { return registry.disposed; },
    enqueue: (noteKey, task) => enqueue(registry, keyOf(noteKey, MATHEMATICA), task),
    async exec(noteKey, line, { signal, timeoutMs }) {
      const key = keyOf(noteKey, MATHEMATICA);
      const cwd = registry.cwds.get(noteKey) ?? tmpdir();
      // Aborting after the send is ignored, so the request itself runs on a signal that never fires.
      const acquired = await acquire(registry, key, MATHEMATICA, { cwd, signal: signal ?? new AbortController().signal, timeoutMs });
      if (typeof acquired === "string") { return acquired === "missing" ? "missing" : "cancelled"; }
      const { session, restarted } = acquired;
      const hooks = hooksFor(registry, key);
      const outcome = await sendRequest(session, registry.nextId++, line, { signal: new AbortController().signal, timeoutMs }, hooks);
      if (outcome.kind === "ended" && (outcome.status === "cancelled" || outcome.status === "timeout")) { registry.restartedKeys.add(key); }
      armIdle(session, registry.idleMs, hooks, () => { registry.restartedKeys.add(key); });
      return { outcome, restarted };
    },
  };
}

export function createCellSessions(options: CellSessionsOptions): ICellRunner {
  const registry: Registry = {
    options,
    idleMs: options.idleMs ?? DEFAULT_IDLE_MS,
    now: options.now ?? Date.now,
    note: (message, data) => { void options.logger?.log("INFO", MODULE_SESSIONS, message, data).catch(() => undefined); },
    sessions: new Map(),
    chains: new Map(),
    restartedKeys: new Set(),
    cwds: new Map(),
    nextId: 1,
    disposed: false,
  };
  const port = mathPort(registry);
  return {
    run(request, opts) {
      registry.cwds.set(request.noteKey, opts.cwd);
      return enqueue(registry, keyOf(request.noteKey, request.language), () => runCell(registry, request, opts));
    },

    runMath: (request, signal) => runMath(port, request, signal),

    async restart(noteKey, language) {
      const key = keyOf(noteKey, language);
      const session = registry.sessions.get(key);
      if (!session) { return; }
      registry.restartedKeys.add(key);
      session.kill("cancelled");
      await session.gone;
    },

    async dispose() {
      registry.disposed = true;
      const all = [...registry.sessions.values()];
      for (const session of all) { session.kill("cancelled"); }
      await Promise.all(all.map((session) => session.gone));
    },
  };
}
