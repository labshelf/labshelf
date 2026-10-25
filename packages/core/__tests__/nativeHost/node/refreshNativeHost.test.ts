/** Pins that refresh rewrites only the owning app's launcher and never installs. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { HELPER_HOST_SPEC, installNativeHost, refreshNativeHost } from "../../../src/nativeHost/node/index";
import { cleanupTempDirs, pathExists } from "../../support/tempDirs";
import { env, launch, readJson } from "./nativeHostHarness";

afterEach(cleanupTempDirs);

const CHROME = "Library/Application Support/Google/Chrome";

describe("refreshNativeHost", () => {
  it("rewrites the launcher and host.json when the owner's paths differ", async () => {
    const e = await env("darwin", [CHROME]);
    const { launcher } = await installNativeHost(e, HELPER_HOST_SPEC, launch);
    const moved = { ...launch, nodePath: "/new/node", electronRunAsNode: true };
    expect(await refreshNativeHost(e, HELPER_HOST_SPEC, moved)).toBe("refreshed");
    expect(await fs.readFile(launcher!, "utf8")).toContain("ELECTRON_RUN_AS_NODE=1 exec '/new/node'");
    expect(await readJson(path.join(path.dirname(launcher!), "host.json"))).toMatchObject({ nodePath: "/new/node", electronRunAsNode: true });
  });

  it("reports unchanged when nothing differs", async () => {
    const e = await env("darwin", [CHROME]);
    await installNativeHost(e, HELPER_HOST_SPEC, launch);
    expect(await refreshNativeHost(e, HELPER_HOST_SPEC, launch)).toBe("unchanged");
  });

  it("leaves another app's install alone", async () => {
    const e = await env("darwin", [CHROME]);
    const { launcher } = await installNativeHost(e, HELPER_HOST_SPEC, launch);
    expect(await refreshNativeHost(e, HELPER_HOST_SPEC, { ...launch, owner: "terminal", nodePath: "/other" })).toBe("not-owned");
    expect(await fs.readFile(launcher!, "utf8")).toContain(launch.nodePath);
  });

  it("installs nothing when no host is installed", async () => {
    const e = await env("darwin", [CHROME]);
    expect(await refreshNativeHost(e, HELPER_HOST_SPEC, launch)).toBe("not-installed");
    expect(await pathExists(path.join(e.home, ".config/labshelf/helper"))).toBe(false);
    expect(await pathExists(path.join(e.home, CHROME, "NativeMessagingHosts"))).toBe(false);
  });
});
