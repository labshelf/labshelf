// Feeds the Details selection hub from the list tab, the All projects tab and the active reader.
import { errorMessage, type ILogger, type SelectionHub } from "@labshelf/core";

const LOG_MODULE = "details.sources";

export interface SelectionSources {
  /** The list tab's selection changed; no ids clears it. */
  listSelected(ids: string[]): void;
  /** The All projects selection changed; null clears it. */
  projectSelected(id: string | null): void;
  /** A reader became the active tab. */
  readerActivated(paperId: string): void;
  listActivated(): void;
  projectsActivated(): void;
}

export function createSelectionSources(hub: SelectionHub, logger: ILogger): SelectionSources {
  // Hub subscribers run inside webview message handlers, so a failure is logged instead of thrown into them.
  const run = (action: string, step: () => void): void => {
    try { step(); } catch (error) { void logger.log("ERROR", LOG_MODULE, "Details selection failed", { action, message: errorMessage(error) }); }
  };
  return {
    listSelected: (ids) => run("list.publish", () => hub.publish("list", ids.length ? { kind: "paper", ids } : null)),
    projectSelected: (id) => run("projects.publish", () => hub.publish("projects", id ? { kind: "project", id } : null)),
    readerActivated: (paperId) => run("reader.publish", () => hub.publish("reader", { kind: "paper", ids: [paperId] })),
    listActivated: () => run("list.activate", () => hub.activate("list")),
    projectsActivated: () => run("projects.activate", () => hub.activate("projects")),
  };
}
