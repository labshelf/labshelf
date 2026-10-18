// Tests for the standalone helper's --uninstall over a scratch home: hosts and bin/ go, the user's projects and tools stay.
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { BRIDGE_HOST_SPEC, HELPER_HOST_SPEC, type NativeHostEnv } from "@labshelf/core/nativeHost/node";
import { registerStandaloneHosts, uninstallStandaloneHelper } from "../../../src/helper/register";
import { makeTempDir } from "../../fixtures/library";

const logger = { log: async () => undefined, error: async () => undefined } as unknown as NativeHostEnv["logger"];
const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

async function setup() {
  const home = await makeTempDir();
  await fs.mkdir(path.join(home, ".config", "google-chrome"), { recursive: true });
  const dataDir = path.join(home, ".local", "share", "labshelf-helper");
  const binary = path.join(dataDir, "bin", "labshelf-helper");
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.writeFile(binary, "binary", { mode: 0o755 });
  const projects = path.join(dataDir, "projects", "thesis", "main.tex");
  await fs.mkdir(path.dirname(projects), { recursive: true });
  await fs.writeFile(projects, "\\documentclass{article}");
  const tools = path.join(home, ".local", "share", "labshelf", "tools", "tinytex");
  await fs.mkdir(tools, { recursive: true });
  const env: NativeHostEnv = { home, platform: "linux", logger };
  const manifest = (host: string): string => path.join(home, ".config", "google-chrome", "NativeMessagingHosts", `${host}.json`);
  return { env, dataDir, binary, projects, tools, manifest };
}

describe("uninstallStandaloneHelper", () => {
  it("removes both manifests, the bridge name and bin/ but keeps projects and the managed tools folder", async () => {
    const { env, dataDir, binary, projects, tools, manifest } = await setup();
    await registerStandaloneHosts(env, binary);

    expect(await uninstallStandaloneHelper(env, binary, dataDir)).toBe(0);

    expect(await exists(manifest(HELPER_HOST_SPEC.hostName))).toBe(false);
    expect(await exists(manifest(BRIDGE_HOST_SPEC.hostName))).toBe(false);
    expect(await exists(path.join(dataDir, "bin"))).toBe(false);
    expect(await exists(projects)).toBe(true);
    expect(await exists(tools)).toBe(true);
  });

  it("succeeds when nothing is installed", async () => {
    const { env, dataDir, binary } = await setup();
    await fs.rm(path.join(dataDir, "bin"), { recursive: true });

    expect(await uninstallStandaloneHelper(env, binary, dataDir)).toBe(0);
  });
});
