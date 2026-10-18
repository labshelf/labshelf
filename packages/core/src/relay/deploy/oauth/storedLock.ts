// Serialises a task across processes that share one secret slot, taking over a lock its holder left behind.
import { bytesToBase64Url } from "../../../encoding/index.js";
import type { RelayClock } from "../waitUntilServing.js";

/** One named value in a secret store that several processes share, such as VS Code's SecretStorage. */
export interface SecretSlot {
  get(): Promise<string | undefined>;
  store(value: string): Promise<void>;
  delete(): Promise<void>;
}

export interface StoredLock { run<T>(task: () => Promise<T>): Promise<T> }

/** A holder that crashed mid-refresh frees the lock after this long; a refresh takes a few seconds. */
const STALE_AFTER_MS = 30_000;
/** Long enough for a competing write to land, so that reading back tells who won. */
const SETTLE_MS = 150;
const POLL_MS = 250;

interface Holder { owner: string; at: number }

function parseHolder(text: string | undefined): Holder | undefined {
  if (!text) { return undefined; }
  try {
    const value = JSON.parse(text) as Partial<Holder>;
    return typeof value.owner === "string" && typeof value.at === "number" ? { owner: value.owner, at: value.at } : undefined;
  } catch {
    return undefined;
  }
}

// TRAP: the slot has no compare-and-set, so the lock writes, waits and reads back; two writers that both read it free
// leave the last write in place, and only that writer proceeds.
export function createStoredLock(slot: SecretSlot, clock: RelayClock): StoredLock {
  async function acquire(owner: string): Promise<void> {
    for (;;) {
      const holder = parseHolder(await slot.get());
      if (!holder || clock.now() - holder.at > STALE_AFTER_MS) {
        await slot.store(JSON.stringify({ owner, at: clock.now() }));
        await clock.sleep(SETTLE_MS);
        if (parseHolder(await slot.get())?.owner === owner) { return; }
      }
      await clock.sleep(POLL_MS);
    }
  }

  return {
    async run(task) {
      const owner = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
      await acquire(owner);
      try {
        return await task();
      } finally {
        if (parseHolder(await slot.get())?.owner === owner) { await slot.delete(); }
      }
    },
  };
}
