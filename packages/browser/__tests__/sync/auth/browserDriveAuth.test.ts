const stored = new Map<string, unknown>();
const launchWebAuthFlow = jest.fn<Promise<string>, [unknown]>();
jest.mock("webextension-polyfill", () => ({
  storage: {
    local: {
      get: async (key: string) => (stored.has(key) ? { [key]: stored.get(key) } : {}),
      set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) stored.set(k, v); },
      remove: async (key: string) => { stored.delete(key); },
    },
  },
  identity: {
    getRedirectURL: () => "https://ext.chromiumapp.org/",
    launchWebAuthFlow: (details: unknown) => launchWebAuthFlow(details),
  },
}));
jest.mock("../../../src/storage/idb/db", () => ({ getDb: async () => require("../../support/fakeIdb").fakeDb }));

import type { ILogger, SyncTimers } from "@labshelf/core";
import { FakeRemoteProvider } from "@labshelf/core/test-support/sync-fakes";

import { BrowserDriveAuth } from "../../../src/sync/auth/browserDriveAuth";
import { createBrowserSync } from "../../../src/sync";
import { fakeFiles } from "../../support/fakeIdb";

const TOKEN_KEY = "labshelf.gdrive.token";
const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const timers: SyncTimers = { start: () => undefined, cancel: () => undefined };

beforeEach(() => {
  stored.clear();
  fakeFiles.clear();
  launchWebAuthFlow.mockReset();
});

describe("BrowserDriveAuth after a service-worker restart", () => {
  it("is signed in once load() read a stored, unexpired token, and the coordinator syncs", async () => {
    stored.set(TOKEN_KEY, { accessToken: "stored", expiryMs: Date.now() + 3_600_000, scope: "drive.file" });
    const auth = new BrowserDriveAuth();
    expect(auth.isAuthenticated()).toBe(false);

    const sync = createBrowserSync({ auth, logger, timers, onSynced: async () => undefined, createProvider: () => new FakeRemoteProvider() });
    await sync.init();

    expect(auth.isAuthenticated()).toBe(true);
    expect(sync.status().state).toBe("idle");
    expect((await sync.syncNow("alarm")).kind).toBe("synced");
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("renews an expired stored token through the silent refresh", async () => {
    stored.set(TOKEN_KEY, { accessToken: "old", expiryMs: Date.now() - 1_000, scope: "drive.file" });
    launchWebAuthFlow.mockResolvedValue("https://ext.chromiumapp.org/#access_token=fresh&expires_in=3600&scope=drive.file");
    const auth = new BrowserDriveAuth();

    await auth.load();

    expect(launchWebAuthFlow).toHaveBeenCalledWith(expect.objectContaining({ interactive: false }));
    expect(auth.isAuthenticated()).toBe(true);
    expect(await auth.getAccessToken()).toBe("fresh");
  });

  it("drops an expired stored token the silent refresh cannot renew, and the sync is skipped", async () => {
    stored.set(TOKEN_KEY, { accessToken: "old", expiryMs: Date.now() - 1_000, scope: "drive.file" });
    launchWebAuthFlow.mockRejectedValue(new Error("consent required"));
    const auth = new BrowserDriveAuth();
    const sync = createBrowserSync({ auth, logger, timers, onSynced: async () => undefined, createProvider: () => new FakeRemoteProvider() });

    expect((await sync.syncNow("alarm")).kind).toBe("skipped");
    expect(stored.has(TOKEN_KEY)).toBe(false);
  });
});
