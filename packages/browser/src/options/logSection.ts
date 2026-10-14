/** The Recent log section: the last background events, for troubleshooting. */
import { el, settingsSection } from "@labshelf/core/dom";
import type { BrowserLogger } from "../platform";

export interface LogSection {
  element: HTMLElement;
  refresh(): Promise<void>;
}

export function createLogSection(logger: BrowserLogger): LogSection {
  const log = el("pre", { class: "settings-log", text: "Loading…" });
  return {
    element: settingsSection({ title: "Recent log", description: "The last background events, for troubleshooting." }, log),
    async refresh() {
      const entries = await logger.recent();
      log.textContent = entries.length === 0
        ? "No log entries yet."
        : entries.map((e) => `${e.timestamp} [${e.level.toUpperCase()}] (${e.module}) ${e.message}`).join("\n");
    },
  };
}
