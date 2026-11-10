// Runs code cells in the browser: one session per (note, language), one run at a time per session, a cancel kills the session.
import type { CellLanguage, CellRequest, CellResult, RunCellPort } from "@labshelf/core";

import { cancelledResult, failedResult, findInvalidParam, toCellResult, unsupportedResult, type RuntimeAnswer } from "./cellResult.js";

/** One interpreter for one note: `run` resolves with the cell's answer (a cell error included) and rejects only when the runtime itself failed. */
export interface CellSession {
  run(request: CellRequest): Promise<RuntimeAnswer>;
  /** Stops the interpreter at once, even in the middle of a run. */
  dispose(): void;
}

/** Opens a session for a language the browser runs; it loads its runtime on its first run. */
export type OpenCellSession = (language: BrowserCellLanguage) => CellSession;

type BrowserCellLanguage = Extract<CellLanguage, "python" | "r">;

export interface BrowserCellPort { run: RunCellPort; restart(noteKey: string, language: CellLanguage): void; dispose(): void }

const isBrowserLanguage = (language: CellLanguage): language is BrowserCellLanguage => language === "python" || language === "r";

/** @returns a cell port over `open`; a cancelled run kills its session, so the next run of that note starts fresh and says `restarted`. */
export function createCellPort(open: OpenCellSession): BrowserCellPort {
  const sessions = new Map<string, CellSession>();
  const queues = new Map<string, Promise<unknown>>();
  const restartedNext = new Set<string>();
  const keyOf = (noteKey: string, language: CellLanguage): string => `${language}\u0000${noteKey}`;

  function drop(key: string): void {
    sessions.get(key)?.dispose();
    sessions.delete(key);
  }

  function sessionOf(key: string, language: BrowserCellLanguage): { session: CellSession; restarted: boolean } {
    const current = sessions.get(key);
    if (current) { return { session: current, restarted: false }; }
    const session = open(language);
    sessions.set(key, session);
    return { session, restarted: restartedNext.delete(key) };
  }

  function runNow(key: string, request: CellRequest & { language: BrowserCellLanguage }, signal: AbortSignal): Promise<CellResult> {
    const { language } = request;
    if (signal.aborted) { return Promise.resolve(cancelledResult(language, 0)); }
    const started = Date.now();
    const elapsed = (): number => Date.now() - started;
    const { session, restarted } = sessionOf(key, language);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: CellResult): void => {
        if (settled) { return; }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const kill = (): void => {
        if (sessions.get(key) === session) { drop(key); restartedNext.add(key); }
      };
      const onAbort = (): void => { kill(); settle(cancelledResult(language, elapsed())); };
      signal.addEventListener("abort", onAbort, { once: true });
      session.run(request).then(
        (answer) => settle(toCellResult(answer, language, elapsed(), restarted)),
        (error: unknown) => { kill(); settle(failedResult(language, error, elapsed(), restarted)); },
      );
    });
  }

  const run: RunCellPort = (request, signal) => {
    const { language } = request;
    if (!isBrowserLanguage(language)) { return Promise.resolve(unsupportedResult(language)); }
    const invalid = findInvalidParam(request.params);
    if (invalid !== undefined) { return Promise.resolve({ status: "error", language, error: `Invalid parameter name ${invalid}`, durationMs: 0 }); }
    const key = keyOf(request.noteKey, language);
    const turn = (queues.get(key) ?? Promise.resolve()).then(() => runNow(key, { ...request, language }, signal));
    const tail = turn.catch(() => undefined);
    queues.set(key, tail);
    void tail.then(() => { if (queues.get(key) === tail) { queues.delete(key); } });
    return turn;
  };

  return {
    run,
    restart(noteKey, language) {
      const key = keyOf(noteKey, language);
      drop(key);
      restartedNext.delete(key);
    },
    dispose() {
      for (const key of [...sessions.keys()]) { drop(key); }
      restartedNext.clear();
    },
  };
}
