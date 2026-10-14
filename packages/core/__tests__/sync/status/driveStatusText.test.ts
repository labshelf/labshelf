import { driveStatusText, type DriveStatus } from "../../../src/sync/status/index.js";

const base: DriveStatus = { connected: true, syncing: false, lastSyncTime: null, lastError: null };

describe("driveStatusText", () => {
  it("says Syncing… first, even when connected with a last sync", () => {
    expect(driveStatusText({ ...base, syncing: true, lastSyncTime: "2024-03-04T14:05:00Z" })).toBe("Syncing…");
  });

  it("names the date and time of the last sync when connected", () => {
    const text = driveStatusText({ ...base, lastSyncTime: "2024-03-04T14:05:00Z" });
    expect(text).toMatch(/^Connected — last sync Mar \d, 2024, /);
  });

  it("says Connected to Google Drive before the first sync or on an unreadable time", () => {
    expect(driveStatusText(base)).toBe("Connected to Google Drive");
    expect(driveStatusText({ ...base, lastSyncTime: "not a date" })).toBe("Connected to Google Drive");
  });

  it("says Not connected when signed out, whatever the last sync was", () => {
    expect(driveStatusText({ ...base, connected: false, lastSyncTime: "2024-03-04T14:05:00Z" })).toBe("Not connected to Google Drive");
  });
});
