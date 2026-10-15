/**
 * Declares the messages between the settings webview and the extension host, plus the guard that validates what the
 * webview sends. Compiled by both tsconfigs, so it holds only types and that guard.
 */
import type { DriveStatus } from "@labshelf/core";

export const SETTINGS_ACTIONS = ["library.reconfigure", "sync.connect", "sync.now", "sync.disconnect", "settings.openNative"] as const;

export type SettingsAction = (typeof SETTINGS_ACTIONS)[number];

export interface SettingsState {
  /** Null while no library is configured. */
  libraryRoot: string | null;
  sync: DriveStatus;
}

export type SettingsWebviewMessage = { type: "ready" } | { type: "action"; action: SettingsAction };

export type SettingsHostMessage = { type: "state"; state: SettingsState };

/** @returns the message when it is one the webview can send, otherwise null */
export function parseSettingsMessage(raw: unknown): SettingsWebviewMessage | null {
  if (typeof raw !== "object" || raw === null) { return null; }
  const { type, action } = raw as { type?: unknown; action?: unknown };
  if (type === "ready") { return { type }; }
  if (type === "action" && SETTINGS_ACTIONS.some((known) => known === action)) {
    return { type, action: action as SettingsAction };
  }
  return null;
}
