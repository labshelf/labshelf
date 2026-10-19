import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createSelfUpdater, type SelfUpdateDeps } from "../../../src/helper/update";
import { asLogger, createUpdateFixture, DAY_MS, NOW, type UpdateFixture } from "./updateFixture";

describe("createSelfUpdater", () => {
  let fixture: UpdateFixture;
  beforeEach(async () => { fixture = await createUpdateFixture(); });
  afterEach(() => fixture.cleanup());

  const updater = (overrides: Partial<SelfUpdateDeps> = {}) => createSelfUpdater({
    currentVersion: "1.0.0", platform: "darwin", arch: "arm64", binaryPath: fixture.binaryPath, dataDir: fixture.dataDir,
    fetchImpl: fixture.fetchImpl, now: () => NOW, logger: asLogger(fixture.logger), publicKey: fixture.publicKey, ...overrides,
  });

  it("replaces the binary with a newer signed release and announces the update", async () => {
    const notify = jest.fn();
    await expect(updater({ notify }).check()).resolves.toBe("updated");
    expect(await fixture.binaryContent()).toBe("new helper binary");
    expect((await stat(fixture.binaryPath)).mode & 0o777).toBe(0o755);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("2.0.0"));
    expect(existsSync(`${fixture.binaryPath}.old`)).toBe(false);
  });

  it("leaves the binary untouched when the signature is from another key", async () => {
    const manifest = Buffer.from(JSON.stringify({ version: "2.0.0", assets: {} }));
    fixture.serve({ manifest, signature: fixture.signWithOtherKey(manifest) });
    await expect(updater().check()).resolves.toBe("failed");
    expect(await fixture.binaryContent()).toBe("old helper binary");
    expect(fixture.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ message: expect.stringMatching(/signature/i) }));
  });

  it("leaves the binary untouched when latest.json changed after signing", async () => {
    const signed = Buffer.from(JSON.stringify({ version: "2.0.0", assets: {} }));
    const tampered = Buffer.from(JSON.stringify({ version: "9.9.9", assets: {} }));
    fixture.serve({ manifest: tampered, signature: fixture.signValid(signed) });
    await expect(updater().check()).resolves.toBe("failed");
    expect(await fixture.binaryContent()).toBe("old helper binary");
    expect(fixture.fetchedUrls().filter((url) => url.includes("helper-darwin"))).toEqual([]);
  });

  it("leaves the binary untouched when the download SHA-256 differs", async () => {
    fixture.serve({ sha256: "0".repeat(64) });
    await expect(updater().check()).resolves.toBe("failed");
    expect(await fixture.binaryContent()).toBe("old helper binary");
    expect(existsSync(`${fixture.binaryPath}.old`)).toBe(false);
    expect(fixture.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ message: expect.stringMatching(/Checksum mismatch/) }));
  });

  it.each(["1.0.0", "0.9.9", "0.10.0"])("does nothing when the release %s is not newer than 1.0.0", async (version) => {
    fixture.serve({ version });
    await expect(updater().check()).resolves.toBe("current");
    expect(await fixture.binaryContent()).toBe("old helper binary");
    expect(fixture.fetchedUrls().filter((url) => url.includes("helper-darwin"))).toEqual([]);
  });

  it("compares versions numerically", async () => {
    fixture.serve({ version: "1.10.0" });
    await expect(updater({ currentVersion: "1.9.0" }).check()).resolves.toBe("updated");
  });

  it("fails without touching the binary when the release has no asset for this platform", async () => {
    await expect(updater({ arch: "riscv64" }).check()).resolves.toBe("failed");
    expect(await fixture.binaryContent()).toBe("old helper binary");
  });

  it("checks at most once a day, across updater instances", async () => {
    fixture.serve({ version: "1.0.0" });
    await expect(updater().check()).resolves.toBe("current");
    const requests = fixture.fetchImpl.mock.calls.length;
    await expect(updater().check()).resolves.toBe("throttled");
    await expect(updater({ now: () => NOW + DAY_MS - 1 }).check()).resolves.toBe("throttled");
    expect(fixture.fetchImpl.mock.calls.length).toBe(requests);
    await expect(updater({ now: () => NOW + DAY_MS }).check()).resolves.toBe("current");
    expect(JSON.parse(await readFile(join(fixture.dataDir, "update-check.json"), "utf8"))).toEqual({ lastCheckAt: NOW + DAY_MS });
  });

  it("checks again within the day when the throttle is bypassed", async () => {
    fixture.serve({ version: "1.0.0" });
    await expect(updater().check()).resolves.toBe("current");
    await expect(updater().check({ bypassThrottle: true })).resolves.toBe("current");
    fixture.serve({ version: "1.10.0" });
    await expect(updater({ currentVersion: "1.9.0" }).check({ bypassThrottle: true })).resolves.toBe("updated");
  });

  it("treats an unreadable throttle file as never checked", async () => {
    await updater().check();
    await writeFile(join(fixture.dataDir, "update-check.json"), "not json");
    fixture.serve({ version: "1.0.0" });
    await expect(updater().check()).resolves.toBe("current");
  });

  it("keeps the old binary as .old on win32 and deletes it after the restart", async () => {
    const win = updater({ platform: "win32", arch: "x64" });
    await expect(win.check()).resolves.toBe("updated");
    expect(await fixture.binaryContent()).toBe("new helper binary");
    expect(await readFile(`${fixture.binaryPath}.old`, "utf8")).toBe("old helper binary");
    await win.cleanupAfterRestart();
    expect(existsSync(`${fixture.binaryPath}.old`)).toBe(false);
  });

  it("does not delete a .old file outside win32", async () => {
    await writeFile(`${fixture.binaryPath}.old`, "keep");
    await updater().cleanupAfterRestart();
    expect(existsSync(`${fixture.binaryPath}.old`)).toBe(true);
  });

  it("checkInBackground returns at once and never rejects, even when the network fails", async () => {
    fixture.fetchImpl.mockRejectedValue(new Error("offline"));
    expect(updater().checkInBackground()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await fixture.binaryContent()).toBe("old helper binary");
    expect(fixture.logger.log).toHaveBeenCalled();
  });
});
