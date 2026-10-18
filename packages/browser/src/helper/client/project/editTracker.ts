// Keeps the text the helper holds per path so an edit can ship as changes, and so a `stale` reply can be answered with the whole text.
import type { HelperEdit, TextChange } from "@labshelf/core/helper";

const MAX_REMEMBERED_EDITS = 256;

interface PathState { version: number; text: string }

export type EditFrame = { text: string } | { changes: TextChange[] };

/** INVARIANT: change positions refer to the text of the previous version, so applying them from the end keeps earlier positions valid. */
function applyChanges(text: string, changes: TextChange[]): string {
  return [...changes].sort((a, b) => b.from - a.from).reduce((current, { from, to, insert }) => {
    if (from < 0 || to < from || to > current.length) { throw new Error(`Edit range ${from}-${to} is outside a text of ${current.length} characters`); }
    return current.slice(0, from) + insert + current.slice(to);
  }, text);
}

export class EditTracker {
  private readonly states = new Map<string, PathState>();
  private readonly sent = new Map<string, string>();

  /** Records the edit and returns the frame body to send. */
  apply(projectId: string, path: string, version: number, edit: HelperEdit): EditFrame {
    const key = `${projectId}:${path}`;
    if ("text" in edit) {
      this.states.set(key, { version, text: edit.text });
      return { text: edit.text };
    }
    const state = this.states.get(key);
    if (!state) { throw new Error(`The first edit of ${path} in ${projectId} must carry the whole text`); }
    this.states.set(key, { version, text: applyChanges(state.text, edit.changes) });
    return { changes: edit.changes };
  }

  /** Remembers which edit a request id carried; the oldest ids fall out past the cap. */
  remember(requestId: string, projectId: string, path: string): void {
    this.sent.set(requestId, `${projectId}:${path}`);
    if (this.sent.size > MAX_REMEMBERED_EDITS) { this.sent.delete(this.sent.keys().next().value as string); }
  }

  /** The whole-text edit that answers a `stale` reply for the request, at the path's current version. */
  resend(requestId: string): { projectId: string; path: string; version: number; text: string } | undefined {
    const key = this.sent.get(requestId);
    const state = key === undefined ? undefined : this.states.get(key);
    if (key === undefined || !state) { return undefined; }
    const split = key.indexOf(":");
    return { projectId: key.slice(0, split), path: key.slice(split + 1), version: state.version, text: state.text };
  }

  /** A new connection starts without any text on the helper's side. */
  forgetAll(): void {
    this.states.clear();
    this.sent.clear();
  }

  forget(projectId: string, path?: string): void {
    const prefix = `${projectId}:`;
    for (const key of [...this.states.keys()]) {
      if (path === undefined ? key.startsWith(prefix) : key === `${prefix}${path}`) { this.states.delete(key); }
    }
  }
}
