// Waits until peers have synced a joined share's index far enough to name its kind and shared settings.
import { indexSettings, readIndexKind } from "../model/index.js";
import type { ShareSession } from "../sync/index.js";

const JOIN_TIMEOUT_MS = 120_000;

/** The share is of a kind this version cannot open, so nothing is created for it. */
export class UnknownShareKindError extends Error {
  constructor(readonly kind: unknown) {
    super(`The share is a ${String(kind)}, which this version of LabShelf cannot open. Update LabShelf and join again.`);
    this.name = "UnknownShareKindError";
  }
}

/** Rejects with UnknownShareKindError, on abort, or when no peer answers in JOIN_TIMEOUT_MS. */
export function projectIndexReady(session: ShareSession, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (error?: Error): void => {
      clearTimeout(timer);
      session.index.off("update", check);
      signal.removeEventListener("abort", onAbort);
      if (error) { reject(error); } else { resolve(); }
    };
    const check = (): void => {
      const kind = readIndexKind(session.index);
      if (!kind.ok && kind.error === "unknownShareKind") { settle(new UnknownShareKindError(kind.kind)); return; }
      if (kind.ok && indexSettings(session.index).size > 0) { settle(); }
    };
    const onAbort = (): void => settle(new Error("Joining was cancelled"));
    const timer = setTimeout(() => settle(new Error("No member of the share answered in 2 minutes; ask one to open the project and try again")), JOIN_TIMEOUT_MS);
    session.index.on("update", check);
    signal.addEventListener("abort", onAbort);
    if (signal.aborted) { onAbort(); } else { check(); }
  });
}
