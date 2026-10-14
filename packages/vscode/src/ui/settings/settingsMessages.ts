/** Maps a message from the settings webview to what the host does: answer ready with the state, run an action, refresh the state. */
import { parseSettingsMessage, type SettingsAction } from "./protocol.js";

export interface SettingsMessageDeps {
  postState: () => void;
  reconfigureLibrary: () => Promise<unknown>;
  executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
  /** Logs a message that is not valid; the webview never sends one, so it signals a bug or a foreign page. */
  warn: (message: string, context: Record<string, unknown>) => void;
}

async function runAction(action: SettingsAction, deps: SettingsMessageDeps): Promise<void> {
  switch (action) {
    case "library.reconfigure":
      await deps.reconfigureLibrary();
      return;
    case "sync.connect":
      await deps.executeCommand("labshelf.sync.connect");
      return;
    case "sync.now":
      await deps.executeCommand("labshelf.sync.now");
      return;
    case "sync.disconnect":
      await deps.executeCommand("labshelf.sync.disconnect");
      return;
    case "settings.openNative":
      await deps.executeCommand("workbench.action.openSettings", "labshelf");
      return;
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled settings action: ${String(unreachable)}`);
    }
  }
}

export async function handleSettingsMessage(raw: unknown, deps: SettingsMessageDeps): Promise<void> {
  const message = parseSettingsMessage(raw);
  if (!message) {
    deps.warn("Settings webview sent a message that is not valid", { type: (raw as { type?: unknown } | null)?.type });
    return;
  }
  if (message.type === "ready") {
    deps.postState();
    return;
  }
  // The page shows the outcome whether the action succeeded, was cancelled or failed.
  try {
    await runAction(message.action, deps);
  } finally {
    deps.postState();
  }
}
