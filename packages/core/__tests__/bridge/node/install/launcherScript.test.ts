/** Pins how the bridge launcher quotes the Node binary and host script paths for sh and cmd.exe. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { installBridge, type RegistryRunner } from "../../../../src/bridge/node/install/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const awkward = { nodePath: "/opt/it's 100%/node", hostScript: "/opt/my host/%PATH%'.js", electronRunAsNode: false };

const registry: RegistryRunner = async (args) => ({ exitCode: args[0] === "query" ? 1 : 0, stdout: "", stderr: "" });

describe("launcher script", () => {
  it("single-quotes sh paths and escapes embedded quotes; % and spaces stay literal", async () => {
    const home = await makeTempDir();
    const result = await installBridge({ home, platform: "linux", logger: fakeLogger() }, awkward);
    const script = await fs.readFile(result.launcher, "utf8");
    expect(script).toBe(`#!/bin/sh\nexec '/opt/it'\\''s 100%/node' '/opt/my host/%PATH%'\\''.js' "$@"\n`);
  });

  it("switches cmd.exe to UTF-8 and doubles % so cmd does not expand it", async () => {
    const home = await makeTempDir();
    const launch = { nodePath: "C:\\Programs\\Zoë's node\\node.exe", hostScript: "C:\\ext\\host 100%PATH%.js", electronRunAsNode: false };
    const result = await installBridge({ home, platform: "win32", logger: fakeLogger(), registry }, launch);
    const script = await fs.readFile(result.launcher, "utf8");
    expect(path.basename(result.launcher)).toBe("labshelf-bridge.cmd");
    expect(script).toBe(`@chcp 65001>nul\r\n@echo off\r\n"C:\\Programs\\Zoë's node\\node.exe" "C:\\ext\\host 100%%PATH%%.js" %*\r\n`);
  });
});
