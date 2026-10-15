/** Builds the Google Drive section of a settings page: the connection status and Connect, or Sync now and Disconnect. */
import { driveStatusText, type DriveStatus } from "../../../sync/status/index.js";
import { el } from "../dom.js";
import { actionButton } from "./actionButton.js";
import { settingsSection, type SettingsContent } from "./settingsSection.js";
import { statusLine, type StatusTone } from "./statusLine.js";

export interface DriveActions {
  connect: () => void | Promise<void>;
  syncNow: () => void | Promise<void>;
  disconnect: () => void | Promise<void>;
}

export interface DriveSection {
  element: HTMLElement;
  update(status: DriveStatus): void;
  /** Shown instead of the status when the host cannot report it. */
  showUnavailable(message: string): void;
}

function toneOf(status: DriveStatus): StatusTone {
  if (status.lastError) { return "error"; }
  return status.connected ? "ok" : "idle";
}

function actionsFor(status: DriveStatus, actions: DriveActions): HTMLButtonElement[] {
  const buttons = status.connected
    ? [
        actionButton({ label: "Sync now", icon: "refresh", onClick: actions.syncNow }),
        actionButton({ label: "Disconnect", icon: "cloud-off", onClick: actions.disconnect }),
      ]
    : [actionButton({ label: "Connect to Google Drive", icon: "cloud", primary: true, onClick: actions.connect })];
  for (const button of buttons) { button.disabled = status.syncing; }
  return buttons;
}

export function driveSection(options: { description: SettingsContent; actions: DriveActions }): DriveSection {
  const status = statusLine();
  const buttons = el("div", { class: "settings-actions" });
  const element = settingsSection({ title: "Google Drive sync", description: options.description }, status.element, buttons);
  return {
    element,
    update(next) {
      status.set(driveStatusText(next), toneOf(next), next.lastError);
      buttons.replaceChildren(...actionsFor(next, options.actions));
    },
    showUnavailable(message) {
      status.set(message, "error");
      buttons.replaceChildren();
    },
  };
}
