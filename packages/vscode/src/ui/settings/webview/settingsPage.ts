/** Renders the VS Code settings page (library folder, Google Drive sync, link to VS Code's own settings) on the core settings components. */
import { actionButton, driveSection, el, settingsPage, settingsSection } from "@labshelf/core/dom";
import type { SettingsAction, SettingsState } from "../protocol.js";

export interface SettingsPageHandle {
  update(state: SettingsState): void;
}

export function mountSettingsPage(root: HTMLElement, send: (action: SettingsAction) => void): SettingsPageHandle {
  const libraryRoot = el("span");
  const act = (action: SettingsAction) => (): void => send(action);

  const library = settingsSection(
    { title: "Library", description: libraryRoot },
    actionButton({ label: "Change library folder", icon: "folder", onClick: act("library.reconfigure") }),
  );
  const drive = driveSection({
    description: "Syncs this library with a LabShelf Library folder in your Google Drive.",
    actions: { connect: act("sync.connect"), syncNow: act("sync.now"), disconnect: act("sync.disconnect") },
  });
  const preferences = settingsSection(
    { title: "Preferences", description: "Sync interval and AI options live in the VS Code settings UI." },
    actionButton({ label: "Open VS Code settings", icon: "gear", onClick: act("settings.openNative") }),
  );

  root.replaceChildren(settingsPage({ title: "LabShelf Settings" }, library, drive.element, preferences));
  return {
    update(state) {
      libraryRoot.textContent = state.libraryRoot ?? "No library configured";
      drive.update(state.sync);
    },
  };
}
