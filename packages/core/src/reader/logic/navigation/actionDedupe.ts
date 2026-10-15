// Detects a keyboard chord delivered twice, once by the webview keydown and once by a host command message.
// INVARIANT: only a repeat from the other source is a duplicate; same-source repeats (held key, palette) all run.

export type ActionSource = "key" | "host";

export interface ActionStamp {
  action: string;
  source: ActionSource;
  at: number;
}

// Round trip webview → host keybinding resolution → extension host → webview; generous because it crosses two processes.
export const CROSS_SOURCE_WINDOW_MS = 250;

/**
 * @returns true when `next` is the same chord arriving a second time through the other route.
 */
export function isDuplicateDelivery(last: ActionStamp | null, next: ActionStamp): boolean {
  if (!last) { return false; }
  return last.action === next.action
    && last.source !== next.source
    && next.at - last.at >= 0
    && next.at - last.at < CROSS_SOURCE_WINDOW_MS;
}
