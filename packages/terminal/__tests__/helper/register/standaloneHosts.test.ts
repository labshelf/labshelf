// Tests for the standalone helper's --register and --unregister: both hosts' manifests, the bridge name next to the binary.
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { BRIDGE_HOST_SPEC, HELPER_HOST_SPEC, installNativeHost, type NativeHostEnv } from "@labshelf/core/nativeHost/node";
import { bridgeShim, registerStandaloneHosts, unregisterStandaloneHosts } from "../../../src/helper/register";
import { makeTempDir } from "../../fixtures/library";

const logger = { log: async () => undefined, error: async () => undefined } as unknown as NativeHostEnv["logger"];

async function setup(): Promise<{ env: NativeHostEnv; binary: string; bridge: string; manifest: (host: string) => string }> {
  const home = await makeTempDir();
  await fs.mkdir(path.join(home, ".config", "google-chrome"), { recursive: true });
  await fs.mkdir(path.join(home, ".mozilla"), { recursive: true });
  const binDir = path.join(home, "bin");
  await fs.mkdir(binDir);
  const binary = path.join(binDir, "labshelf-helper");
  await fs.writeFile(binary, "binary", { mode: 0o755 });
  const manifest = (host: string): string => path.join(home, ".config", "google-chrome", "NativeMessagingHosts", `${host}.json`);
  return { env: { home, platform: "linux", logger }, binary, bridge: path.join(binDir, "labshelf-bridge"), manifest };
}

const pathOf = async (file: string): Promise<string> => (JSON.parse(await fs.readFile(file, "utf8")) as { path: string }).path;
const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

describe("registerStandaloneHosts", () => {
  it("writes the helper manifest at the binary and the bridge manifest at labshelf-bridge, a symlink to the binary", async () => {
    const { env, binary, bridge, manifest } = await setup();

    expect(await registerStandaloneHosts(env, binary)).toBe(0);

    expect(await pathOf(manifest(HELPER_HOST_SPEC.hostName))).toBe(binary);
    expect(await pathOf(manifest(BRIDGE_HOST_SPEC.hostName))).toBe(bridge);
    expect(await fs.readlink(bridge)).toBe("labshelf-helper");
    expect(await fs.realpath(bridge)).toBe(await fs.realpath(binary));
    expect(await exists(path.join(env.home, ".mozilla", "native-messaging-hosts", `${BRIDGE_HOST_SPEC.hostName}.json`))).toBe(true);
  });

  it("replaces manifests that point at an app launcher and is repeatable", async () => {
    const { env, binary, bridge, manifest } = await setup();
    await installNativeHost(env, BRIDGE_HOST_SPEC, { kind: "script", owner: "terminal", nodePath: "/n/node", hostScript: "/n/bridgeHost.js", electronRunAsNode: false });

    await registerStandaloneHosts(env, binary);
    expect(await registerStandaloneHosts(env, binary)).toBe(0);

    expect(await pathOf(manifest(BRIDGE_HOST_SPEC.hostName))).toBe(bridge);
  });

  it("fails when no browser is installed", async () => {
    const { env, binary } = await setup();
    await fs.rm(path.join(env.home, ".config", "google-chrome"), { recursive: true });
    await fs.rm(path.join(env.home, ".mozilla"), { recursive: true });

    expect(await registerStandaloneHosts(env, binary)).toBe(1);
  });
});

describe("unregisterStandaloneHosts", () => {
  it("removes both manifests and the bridge name but keeps the binary", async () => {
    const { env, binary, bridge, manifest } = await setup();
    await registerStandaloneHosts(env, binary);

    expect(await unregisterStandaloneHosts(env, binary)).toBe(0);

    expect(await exists(manifest(HELPER_HOST_SPEC.hostName))).toBe(false);
    expect(await exists(manifest(BRIDGE_HOST_SPEC.hostName))).toBe(false);
    expect(await exists(bridge)).toBe(false);
    expect(await exists(binary)).toBe(true);
  });

  it("keeps a manifest that points at another install", async () => {
    const { env, binary, manifest } = await setup();
    await registerStandaloneHosts(env, binary);
    await installNativeHost(env, BRIDGE_HOST_SPEC, { kind: "binary", path: "/elsewhere/labshelf-bridge" });

    await unregisterStandaloneHosts(env, binary);

    expect(await pathOf(manifest(BRIDGE_HOST_SPEC.hostName))).toBe("/elsewhere/labshelf-bridge");
  });
});

describe("bridgeShim", () => {
  it("starts the helper executable next to it with --host=bridge and passes the browser arguments on", () => {
    expect(bridgeShim("labshelf-helper.exe")).toBe('@echo off\r\n"%~dp0labshelf-helper.exe" --host=bridge %*\r\n');
  });
});
