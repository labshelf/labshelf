// Runs code cells in one persistent driver process per (note key, language): JSON request lines go to stdin, a sentinel-framed JSON line comes back.
import { tmpdir } from "node:os";

import type { ILogger } from "../../../ports/index.js";
import type { CellLanguage } from "../cellLanguage.js";
import type { CellResult, CellStatus, ICellRunner } from "../cellRunner.js";
import { toResult } from "./cellDriverProtocol.js";
import { runMath, type MathPort } from "./mathRequest.js";
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

async function runCell(registry: Registry, { code, language, noteKey, params, preview }: RunRequest, opts: RunOptions, started: number): Promise<CellResult> {
  const elapsed = (): number => registry.now() - started;
  const key = keyOf(noteKey, language);
  if (opts.signal.aborted || registry.disposed) { return { status: "cancelled", language, durationMs: elapsed() }; }
  const acquired = await acquire(registry, key, language, opts);
  if (typeof acquired === "string") { return { status: acquired, language, durationMs: elapsed() }; }
  const { session, restarted } = acquired;
  const hooks = hooksFor(registry, key);
  const withParams = params !== undefined && Object.keys(params).length > 0;
  const line = { code, ...(withParams ? { params } : {}), ...(preview === true ? { preview: true } : {}) };
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
      const started = registry.now();
      registry.cwds.set(request.noteKey, opts.cwd);
      return enqueue(registry, keyOf(request.noteKey, request.language), () => runCell(registry, request, opts, started));
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
