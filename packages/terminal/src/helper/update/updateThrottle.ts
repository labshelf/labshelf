// Remembers when the last update check ran so that checks happen at most once a day.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = "update-check.json";

export async function isCheckDue(dataDir: string, now: number): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(join(dataDir, STATE_FILE), "utf8")) as { lastCheckAt?: unknown };
    return typeof state.lastCheckAt !== "number" || now - state.lastCheckAt >= CHECK_INTERVAL_MS;
  } catch {
    // A missing or corrupt state file means no check is on record.
    return true;
  }
}

export async function recordCheck(dataDir: string, now: number): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, STATE_FILE), JSON.stringify({ lastCheckAt: now }));
}
