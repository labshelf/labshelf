// Debounced save of text documents: each document's timer restarts on every schedule and saves it only while it is still dirty.
import * as vscode from "vscode";
import { AUTO_SAVE_DELAY_MS } from "@labshelf/core";

/** Saves a document `delayMs` after the last `schedule` of it; documents are timed independently and `dispose` cancels the pending saves without saving. */
export function createAutosave(delayMs: number = AUTO_SAVE_DELAY_MS): { schedule(document: vscode.TextDocument): void; dispose(): void } {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    schedule(document): void {
      const key = document.uri.toString();
      const pending = timers.get(key);
      if (pending !== undefined) clearTimeout(pending);
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        if (document.isDirty) void Promise.resolve(document.save()).catch(() => undefined);
      }, delayMs));
    },
    dispose(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
