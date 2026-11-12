// The reader page's hold on its paper's notes.qmd: the replica stays open while the page lives, and each burst of changes
// to it (this page's writes or another tab's edits) is reported so the reader can push the notes again.
import { systemScheduler, type SessionScheduler } from "@labshelf/core";
import type { LiveFiles } from "../../localSync/liveFiles";

const DEFAULT_DELAY_MS = 100;

/**
 * Opens `path` in the page's live files and holds it until `release`; once the replica is ready, calls `onChange` once
 * `delayMs` after the last of a burst of doc updates. A replica that fails to become ready reports nothing.
 * @returns release, which flushes the file, then releases it, and cancels a pending `onChange`.
 */
export function followLiveNotes(options: { live: LiveFiles; path: string; onChange: () => void; delayMs?: number; scheduler?: SessionScheduler }): { release(): Promise<void> } {
  const { onChange } = options;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const scheduler = options.scheduler ?? systemScheduler;
  const file = options.live.open(options.path);
  let stopped = false;
  let cancelPending: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;

  const onUpdate = (): void => {
    cancelPending?.();
    cancelPending = scheduler.after(delayMs, () => { cancelPending = undefined; if (!stopped) onChange(); });
  };
  // INVARIANT: the subscription starts after ready, so the text the replica starts from is not reported as a change.
  void file.replica.ready.then(
    () => {
      if (stopped) return;
      file.replica.doc.on("update", onUpdate);
      unsubscribe = () => file.replica.doc.off("update", onUpdate);
    },
    () => undefined,
  );

  let released: Promise<void> | undefined;
  return {
    release: () => (released ??= (async () => {
      stopped = true;
      cancelPending?.();
      cancelPending = undefined;
      unsubscribe?.();
      await file.flush();
      await file.release();
    })()),
  };
}
