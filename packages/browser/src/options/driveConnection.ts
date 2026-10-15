/** Builds the options page's Google Drive section: the background's sync status and the Connect, Sync now and Disconnect requests. */
import { driveSection, inlineCode, type DriveSection } from "@labshelf/core/dom";
import type { BrowserLogger, RuntimeMessage, SyncStatusData } from "../platform";
import { send } from "./runtimeSend";

type DriveRequest = Extract<RuntimeMessage["type"], "sync.now" | "auth.connect" | "auth.disconnect">;

export interface DriveConnection {
  section: DriveSection;
  refresh(): Promise<void>;
}

/** `afterAction` runs once an action has finished, e.g. to show the log lines it wrote. */
export function createDriveConnection(logger: BrowserLogger, afterAction: () => Promise<void>): DriveConnection {
  async function refresh(): Promise<void> {
    try {
      section.update(await send<SyncStatusData>({ type: "sync.status" }));
    } catch (err) {
      section.showUnavailable(`Background unavailable — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const run = (type: DriveRequest) => async (): Promise<void> => {
    try {
      await send({ type });
      await logger.info(`${type} via options page`);
    } catch (err) {
      await logger.error("options", err, { op: type });
    } finally {
      await refresh();
      await afterAction();
    }
  };

  const section = driveSection({
    description: ["LabShelf syncs this browser's library with the same ", inlineCode("LabShelf Library/"), " folder the VS Code extension uses."],
    actions: { connect: run("auth.connect"), syncNow: run("sync.now"), disconnect: run("auth.disconnect") },
  });
  return { section, refresh };
}
