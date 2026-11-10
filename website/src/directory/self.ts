// POST /api/directory/self (documents/contracts/directory.md#endpoints): the caller's own relay URL and nothing else of their row.
import {
  bumpCounter, callerEmail, day, emailKey, errorResponse, findRow, hour, json, LIMITS, readCounter, Refusal,
  type DirectoryDeps, type DirectoryEnv,
} from "./common";

/** Answers {relayUrl} for the caller's own row; the inbox token and keys never leave the directory. */
export async function self(request: Request, env: DirectoryEnv, deps: DirectoryDeps, now: number): Promise<Response> {
  try {
    const key = await emailKey(env, await callerEmail(request, deps));
    const hourKey = `self:${key}`;
    const dayKey = `selfday:${key}`;
    if ((await readCounter(env.DB, hourKey, hour(now))).count >= LIMITS.selfPerHour
      || (await readCounter(env.DB, dayKey, day(now))).count >= LIMITS.selfPerDay) {
      throw new Refusal("rate_limited");
    }
    await bumpCounter(env.DB, hourKey, hour(now));
    await bumpCounter(env.DB, dayKey, day(now));
    const row = await findRow(env.DB, key);
    if (!row) { throw new Refusal("not_found"); }
    // The relay serves the inbox at its root, so the registered inbox URL is the relay URL.
    return json({ relayUrl: row.inboxUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
