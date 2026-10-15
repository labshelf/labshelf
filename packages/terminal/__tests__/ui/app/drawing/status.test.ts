import { syncSegment } from "../../../../src/ui/app/drawing/status";
import { theme } from "../../../../src/ui/theme";

describe("syncSegment", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  const run = (app: string, minutesAgo: number): NonNullable<Parameters<typeof syncSegment>[0]["lastRun"]> => ({
    providerId: "google-drive", app, host: "h", startedAt: "", finishedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [],
  });

  it("says Drive is not set up", () => {
    expect(syncSegment({ state: "unconfigured" }, now)).toEqual({ text: " Drive: not set up ", style: theme.sync.off });
  });

  it("says the user is signed out", () => {
    expect(syncSegment({ state: "disconnected" }, now)).toEqual({ text: " Drive: signed out ", style: theme.sync.off });
  });

  it("shows a sync in progress", () => {
    expect(syncSegment({ state: "syncing" }, now)).toEqual({ text: " syncing… ", style: theme.sync.busy });
  });

  it("names the app whose sync is being waited for", () => {
    const holder = (app: string) => ({ app, pid: 1, host: "h", token: "t", acquiredAt: "", heartbeatAt: "" });
    expect(syncSegment({ state: "waiting", holder: holder("vscode") }, now).text).toBe(" VS Code syncing ");
    expect(syncSegment({ state: "waiting", holder: holder("terminal") }, now).text).toBe(" Another terminal session syncing ");
    expect(syncSegment({ state: "waiting", holder: holder("browser") }, now).text).toBe(" Another app syncing ");
    expect(syncSegment({ state: "waiting" }, now)).toEqual({ text: " Another app syncing ", style: theme.sync.busy });
  });

  it("shows a failed sync", () => {
    expect(syncSegment({ state: "error", lastError: "boom" }, now)).toEqual({ text: " sync failed ", style: theme.sync.error });
  });

  it("says nothing was synced yet", () => {
    expect(syncSegment({ state: "idle" }, now)).toEqual({ text: " Drive: not synced yet ", style: theme.sync.off });
  });

  it("shows when the last sync of this terminal finished", () => {
    expect(syncSegment({ state: "idle", lastRun: run("terminal", 5) }, now)).toEqual({ text: " synced 5m ago ", style: theme.sync.ok });
  });

  it("names the other app that did the last sync", () => {
    expect(syncSegment({ state: "idle", lastRun: run("vscode", 120) }, now).text).toBe(" synced 2h ago (VS Code) ");
    expect(syncSegment({ state: "idle", lastRun: run("browser", 0) }, now).text).toBe(" synced just now (browser) ");
  });
});
