/** Builds the Recent log section: the last background events, for troubleshooting. */
import { renderElement, renderSettingsSection } from "@labshelf/core/dom";
import type { StorageRingLogSink } from "../platform";

export interface LogSection {
  element: HTMLElement;
  refresh(): Promise<void>;
}

export function createLogSection(ring: StorageRingLogSink): LogSection {
  const log = renderElement("pre", { class: "settings-log", text: "Loading…" });
  return {
    element: renderSettingsSection({ title: "Recent log", description: "The last background events, for troubleshooting." }, log),
    async refresh() {
      const entries = await ring.recent();
      log.textContent = entries.length === 0
        ? "No log entries yet."
        : entries.map((e) => `${e.timestamp} [${e.level.toUpperCase()}] (${e.module}) ${e.message}`).join("\n");
    },
  };
}
