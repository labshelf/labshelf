/** Pins how the native-host launcher quotes the Node binary and host script paths for sh and cmd.exe. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BRIDGE_HOST_SPEC, installNativeHost, type RegistryRunner } from "../../../../src/nativeHost/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const awkward = { kind: "script", owner: "vscode", nodePath: "/opt/it's 100%/node", hostScript: "/opt/my host/%PATH%'.js", electronRunAsNode: false } as const;

const registry: RegistryRunner = async (args) => ({ exitCode: args[0] === "query" ? 1 : 0, stdout: "", stderr: "" });

describe("launcher script", () => {
  it("single-quotes sh paths and escapes embedded quotes; % and spaces stay literal", async () => {
    const home = await makeTempDir();
    const result = await installNativeHost({ home, platform: "linux", logger: fakeLogger() }, BRIDGE_HOST_SPEC, awkward);
    const script = await fs.readFile(result.launcher!, "utf8");
    expect(script).toBe(`#!/bin/sh\nexec '/opt/it'\\''s 100%/node' '/opt/my host/%PATH%'\\''.js' "$@"\n`);
  });

  it("switches cmd.exe to UTF-8 and doubles % so cmd does not expand it", async () => {
    const home = await makeTempDir();
    const launch = { kind: "script", owner: "vscode", nodePath: "C:\\Programs\\Zoë's node\\node.exe", hostScript: "C:\\ext\\host 100%PATH%.js", electronRunAsNode: false } as const;
    const result = await installNativeHost({ home, platform: "win32", logger: fakeLogger(), registry }, BRIDGE_HOST_SPEC, launch);
    const script = await fs.readFile(result.launcher!, "utf8");
    expect(path.basename(result.launcher!)).toBe("labshelf-bridge.cmd");
    expect(script).toBe(`@chcp 65001>nul\r\n@echo off\r\n"C:\\Programs\\Zoë's node\\node.exe" "C:\\ext\\host 100%%PATH%%.js" %*\r\n`);
  });
});
