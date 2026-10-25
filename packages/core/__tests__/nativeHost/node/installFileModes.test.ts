/** Pins the private modes the installer gives the host folder, host.json and manifests, and the launcher's executable bit. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BRIDGE_HOST_NAME } from "../../../src/bridge/index";
import { BRIDGE_HOST_SPEC, installNativeHost } from "../../../src/nativeHost/node/index";
import { cleanupTempDirs } from "../../support/tempDirs";
import { env, launch } from "./nativeHostHarness";

afterEach(cleanupTempDirs);

const posix = process.platform === "win32" ? describe.skip : describe;
const modeOf = async (file: string) => (await fs.stat(file)).mode & 0o777;

posix("installNativeHost file modes", () => {
  it("keeps the host folder at 0o700, host.json and manifests at 0o600, and the launcher at 0o755", async () => {
    const e = await env("linux", [".config/google-chrome"]);
    const hostDir = path.join(e.home, ".config/labshelf/bridge");
    await fs.mkdir(hostDir, { recursive: true, mode: 0o755 });
    await installNativeHost(e, BRIDGE_HOST_SPEC, launch);

    expect(await modeOf(hostDir)).toBe(0o700);
    expect(await modeOf(path.join(hostDir, "host.json"))).toBe(0o600);
    expect(await modeOf(path.join(hostDir, "labshelf-bridge"))).toBe(0o755);
    expect(await modeOf(path.join(e.home, ".config/google-chrome/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`))).toBe(0o600);
  });
});
