// Serialises changes to the shared managed TeX across every LabShelf process with a lock file in its folder.
// CONTRACT: documents/contracts/managed-tex.md#lock
import { link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ILogger } from "../../../../../ports/index.js";

import { TEX_MODULE } from "./runTexTool.js";

export interface TexLockOptions {
  pollMs?: number;
  timeoutMs?: number;
  isAlive?: (pid: number) => boolean;
}

interface Holder { pid: number; operation: string; startedAt: string }

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

async function tryCreate(file: string, content: string): Promise<boolean> {
  try {
    await writeFile(file, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") { return false; }
    throw error;
  }
}

/** The lock's text, or null when it vanished between the failed create and this read. */
async function readLock(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") { return null; }
    throw error;
  }
}

function parseHolder(text: string): Holder | null {
  try {
    const value = JSON.parse(text) as Partial<Holder>;
    return typeof value.pid === "number" && typeof value.operation === "string" ? value as Holder : null;
  } catch {
    return null;
  }
}

async function isStale(file: string, text: string, timeoutMs: number, isAlive: (pid: number) => boolean): Promise<boolean> {
  const holder = parseHolder(text);
  if (holder) { return !isAlive(holder.pid); }
  // TRAP: a holder may be between creating the file and writing it, so only an old garbled lock is stale.
  try {
    return Date.now() - (await stat(file)).mtimeMs > timeoutMs;
  } catch {
    return false;
  }
}

/** Removes the lock only if it still holds `text`; a lock another process took in between is put back. */
async function removeStale(file: string, text: string, logger: ILogger): Promise<void> {
  const aside = `${file}.stale-${process.pid}-${Date.now()}`;
  try {
    await rename(file, aside);
  } catch (error) {
    if (errorCode(error) === "ENOENT") { return; }
    throw error;
  }
  if ((await readLock(aside)) !== text) {
    await link(aside, file).catch((error: unknown) => logger.error(TEX_MODULE, error, { step: "restore a TeX lock taken over by mistake", file }));
  }
  await rm(aside, { force: true });
}

async function releaseOwn(file: string, own: string, logger: ILogger): Promise<void> {
  try {
    if ((await readLock(file)) === own) { await rm(file, { force: true }); }
  } catch (error) {
    await logger.error(TEX_MODULE, error, { step: "release TeX lock", file });
  }
}

/** Runs `run` while holding `<texRoot>/.lock`; waits for another holder and takes over a stale lock. */
export async function withTexLock<T>(texRoot: string, operation: string, logger: ILogger, run: () => Promise<T>, options: TexLockOptions = {}): Promise<T> {
  const { pollMs = 500, timeoutMs = 15 * 60_000, isAlive = processAlive } = options;
  const file = join(texRoot, ".lock");
  const own = JSON.stringify({ pid: process.pid, operation, startedAt: new Date().toISOString() } satisfies Holder);
  await mkdir(texRoot, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let waiting = false;
  while (!(await tryCreate(file, own))) {
    const text = await readLock(file);
    if (text === null) { continue; }
    if (await isStale(file, text, timeoutMs, isAlive)) {
      await logger.log("WARN", TEX_MODULE, "Taking over a stale TeX lock", { file, holder: text, operation });
      await removeStale(file, text, logger);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting to ${operation}: the TeX folder is locked by ${text}`);
    }
    if (!waiting) {
      waiting = true;
      await logger.log("INFO", TEX_MODULE, "Waiting for another LabShelf process to finish with the TeX folder", { file, holder: text, operation });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  try {
    return await run();
  } finally {
    await releaseOwn(file, own, logger);
  }
}
