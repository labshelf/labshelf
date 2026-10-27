// Holds the Web Lock that lets one tab of this browser profile run a share's session and mirror.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import { isAbortError } from "@labshelf/core";

export interface TabLease {
  /** Fires once when another tab takes the lock over, also for a listener added after that; the tab then stops writing to disk. */
  onLost(listener: () => void): void;
  release(): Promise<void>;
}

export type TabLeaseResult = { kind: "busy" } | { kind: "owned"; lease: TabLease };

export function createTabLeaseName(libraryId: string, shareId: string): string {
  return `labshelf:collab:${libraryId}:${shareId}`;
}

// INVARIANT: the lock is held while the request callback's promise is pending; resolving it releases the lock.
function holdLock(name: string, options: LockOptions): Promise<TabLease | undefined> {
  return new Promise((resolveAcquire, rejectAcquire) => {
    const listeners: Array<() => void> = [];
    let acquired = false;
    let ended = false;
    let lost = false;
    let releaseHeld: () => void = () => {};
    const held = new Promise<void>((resolve) => { releaseHeld = resolve; });
    let settled: Promise<void> = Promise.resolve();
    const lease: TabLease = {
      onLost: (listener) => { if (lost) { queueMicrotask(listener); } else { listeners.push(listener); } },
      release: async () => {
        if (ended) { return; }
        releaseHeld();
        await settled;
      },
    };
    const request = navigator.locks.request(name, options, async (lock) => {
      if (!lock) { resolveAcquire(undefined); return; }
      acquired = true;
      resolveAcquire(lease);
      await held;
    });
    // PLATFORM: a steal rejects the old holder's request with AbortError; that rejection is the only loss signal.
    settled = request.then(
      () => { ended = true; },
      (error: unknown) => {
        ended = true;
        if (acquired && isAbortError(error)) { lost = true; for (const listener of listeners) { listener(); } return; }
        rejectAcquire(error);
      },
    );
  });
}

/** Takes the share's lock only if no other tab holds it. */
export async function openTabLease(name: string): Promise<TabLeaseResult> {
  const lease = await holdLock(name, { mode: "exclusive", ifAvailable: true });
  return lease ? { kind: "owned", lease } : { kind: "busy" };
}

/** Takes the share's lock from the tab holding it ("Use here"). */
export async function updateTabLease(name: string): Promise<TabLease> {
  const lease = await holdLock(name, { mode: "exclusive", steal: true });
  if (!lease) { throw new Error(`The browser granted no lock for ${name} on a steal request`); }
  return lease;
}

/** Waits until no other tab holds the share's lock, then takes it; rejects with the AbortError when `signal` aborts first. */
export async function watchTabLease(name: string, signal: AbortSignal): Promise<TabLease> {
  const lease = await holdLock(name, { mode: "exclusive", signal });
  if (!lease) { throw new Error(`The browser granted no lock for ${name} on a waiting request`); }
  return lease;
}
