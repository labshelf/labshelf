// Tests for the sync and auth subcommands, reached through runLibraryCommand, covering only the
// paths that do not reach Google Drive.
import { promises as fs } from "node:fs";

import { UsageError } from "../../src/cli";
import { CliSessionHarness, PAPERS } from "../fixtures/cliSession";

let harness: CliSessionHarness;

beforeEach(async () => {
  harness = new CliSessionHarness();
  await harness.setup();
});

afterEach(async () => {
  await harness.teardown();
});

describe("sync and auth (offline paths only)", () => {
  it("sync skips with exit 1 and a hint when not signed in", async () => {
    const s = await harness.session();
    expect(await s.run("sync")).toBe(1);
    expect(s.errText()).toBe("sync skipped: not signed in to Google Drive — run `labshelf auth login`");
  });

  it("sync skips without a hint when no OAuth client is configured", async () => {
    const s = await harness.session(PAPERS, { env: { LABSHELF_GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID" } });
    expect(await s.run("sync")).toBe(1);
    expect(s.errText()).toBe("sync skipped: no Google OAuth client configured");
  });

  it("sync --json prints the outcome", async () => {
    const s = await harness.session();
    expect(await s.run("sync", "--json")).toBe(1);
    expect(JSON.parse(s.text())).toEqual({ kind: "skipped", reason: "not signed in to Google Drive" });
  });

  it("sync reports VS Code as the holder while it syncs this library, without touching Drive", async () => {
    await harness.signIn();
    const info = { app: "vscode", pid: 424242, host: "another-computer", token: "t", acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    const s = await harness.session(PAPERS, { prepare: async (lib) => { await fs.writeFile(lib.paths.layout.lockPath(), JSON.stringify(info)); } });
    expect(await s.run("sync")).toBe(1);
    expect(s.errText()).toBe("VS Code is syncing this library right now.");
    expect(s.ctx.sync.status().state).toBe("waiting");
    expect(JSON.parse(await fs.readFile(s.lib.paths.layout.lockPath(), "utf8"))).toMatchObject({ app: "vscode", token: "t" });
  });

  it("sync names another LabShelf app when that is the holder", async () => {
    await harness.signIn();
    const info = { app: "browser", pid: 424242, host: "another-computer", token: "t", acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    const s = await harness.session(PAPERS, { prepare: async (lib) => { await fs.writeFile(lib.paths.layout.lockPath(), JSON.stringify(info)); } });
    expect(await s.run("sync")).toBe(1);
    expect(s.errText()).toBe("Another LabShelf app is syncing this library right now.");
  });

  it("auth status shows signed out / signed in and the last sync by any app", async () => {
    const lastRun = {
      providerId: "google-drive", app: "vscode", host: "laptop", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      uploaded: 1, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [],
    };
    const out = await harness.session(PAPERS, { prepare: async (lib) => { await fs.writeFile(lib.paths.layout.lastRunPath(), JSON.stringify(lastRun)); } });
    expect(await out.run("auth", "status")).toBe(0);
    expect(out.out).toEqual(["drive:     signed out", "last sync: just now by vscode on laptop"]);

    await harness.signIn();
    const inn = await harness.session();
    await inn.run("auth");
    expect(inn.out).toEqual(["drive:     signed in", "last sync: never"]);
  });

  it("auth status says so when no OAuth client is configured", async () => {
    const s = await harness.session(PAPERS, { env: { LABSHELF_GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID" } });
    await s.run("auth", "status");
    expect(s.out[0]).toBe("drive:     no OAuth client configured");
  });

  it("auth logout while signed out is harmless and prints a confirmation", async () => {
    const s = await harness.session();
    expect(await s.run("auth", "logout")).toBe(0);
    expect(s.text()).toBe("Signed out. The library stays on this computer.");
  });

  it("auth with an unknown subcommand is a usage error", async () => {
    const s = await harness.session();
    await expect(s.run("auth", "frobnicate")).rejects.toThrow(/Usage: labshelf auth login \| logout \| status/);
  });
});
