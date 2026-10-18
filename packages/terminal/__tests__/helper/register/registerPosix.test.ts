import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { registerHelper, unregisterHelper } from "../../../src/helper/register/index.js";
import { createFixture, type RegisterFixture } from "./registerFixtures.js";

const MANIFEST = "dev.labshelf.helper.json";
let fx: RegisterFixture;
afterEach(() => fx.cleanup());

const exists = (p: string): Promise<boolean> => readFile(p).then(() => true, () => false);

describe("register on macOS", () => {
  const support = (home: string): string => path.join(home, "Library", "Application Support");

  it("writes a manifest for each browser whose config dir exists and skips the others", async () => {
    fx = await createFixture("darwin");
    await mkdir(path.join(support(fx.deps.homeDir), "Google", "Chrome"), { recursive: true });
    await mkdir(path.join(support(fx.deps.homeDir), "Firefox"), { recursive: true });

    expect(await registerHelper(fx.deps)).toBe(0);

    const chrome = path.join(support(fx.deps.homeDir), "Google", "Chrome", "NativeMessagingHosts", MANIFEST);
    const firefox = path.join(support(fx.deps.homeDir), "Mozilla", "NativeMessagingHosts", MANIFEST);
    expect(JSON.parse(await readFile(chrome, "utf8"))).toMatchObject({
      name: "dev.labshelf.helper", path: "/opt/labshelf/labshelf-helper", type: "stdio",
      allowed_origins: ["chrome-extension://ghcjlkjggiffdekaneoaoklhedjeeklh/"],
    });
    expect(JSON.parse(await readFile(firefox, "utf8"))).toMatchObject({ allowed_extensions: ["labshelf@lucanaasser.dev"] });
    expect(await exists(path.join(support(fx.deps.homeDir), "Microsoft Edge", "NativeMessagingHosts", MANIFEST))).toBe(false);
    expect(await exists(path.join(support(fx.deps.homeDir), "Chromium"))).toBe(false);
    expect(fx.logs.filter((m) => m === "Registered host manifest")).toHaveLength(2);
  });

  it("returns 0 and writes nothing when no browser is present", async () => {
    fx = await createFixture("darwin");
    expect(await registerHelper(fx.deps)).toBe(0);
    expect(await readdir(fx.deps.homeDir)).toEqual([]);
  });

  it("refuses a relative binary path", async () => {
    fx = await createFixture("darwin");
    await mkdir(path.join(support(fx.deps.homeDir), "Google", "Chrome"), { recursive: true });
    expect(await registerHelper({ ...fx.deps, binaryPath: "labshelf-helper" })).toBe(1);
    expect(await exists(path.join(support(fx.deps.homeDir), "Google", "Chrome", "NativeMessagingHosts", MANIFEST))).toBe(false);
  });

  it("unregister removes only the LabShelf manifests", async () => {
    fx = await createFixture("darwin");
    const hosts = path.join(support(fx.deps.homeDir), "Google", "Chrome", "NativeMessagingHosts");
    await mkdir(hosts, { recursive: true });
    await writeFile(path.join(hosts, "com.other.host.json"), "{}");
    await registerHelper(fx.deps);

    expect(await unregisterHelper(fx.deps)).toBe(0);
    expect(await readdir(hosts)).toEqual(["com.other.host.json"]);
    expect(await unregisterHelper(fx.deps)).toBe(0);
  });
});

describe("register on Linux", () => {
  it("writes Chromium-family manifests under the config home and Firefox under ~/.mozilla", async () => {
    fx = await createFixture("linux");
    const home = fx.deps.homeDir;
    await mkdir(path.join(home, ".config", "google-chrome"), { recursive: true });
    await mkdir(path.join(home, ".config", "microsoft-edge"), { recursive: true });
    await mkdir(path.join(home, ".mozilla"), { recursive: true });

    expect(await registerHelper(fx.deps)).toBe(0);

    expect(await exists(path.join(home, ".config", "google-chrome", "NativeMessagingHosts", MANIFEST))).toBe(true);
    expect(await exists(path.join(home, ".config", "microsoft-edge", "NativeMessagingHosts", MANIFEST))).toBe(true);
    expect(await exists(path.join(home, ".mozilla", "native-messaging-hosts", MANIFEST))).toBe(true);
    expect(await exists(path.join(home, ".config", "chromium", "NativeMessagingHosts", MANIFEST))).toBe(false);
  });

  it("honours XDG_CONFIG_HOME", async () => {
    fx = await createFixture("linux");
    const xdg = path.join(fx.root, "xdg");
    await mkdir(path.join(xdg, "chromium"), { recursive: true });
    expect(await registerHelper({ ...fx.deps, env: { XDG_CONFIG_HOME: xdg } })).toBe(0);
    expect(await exists(path.join(xdg, "chromium", "NativeMessagingHosts", MANIFEST))).toBe(true);
  });

  it("unregister deletes the manifests it wrote", async () => {
    fx = await createFixture("linux");
    const hosts = path.join(fx.deps.homeDir, ".mozilla", "native-messaging-hosts");
    await mkdir(path.join(fx.deps.homeDir, ".mozilla"), { recursive: true });
    await registerHelper(fx.deps);
    expect(await exists(path.join(hosts, MANIFEST))).toBe(true);
    expect(await unregisterHelper(fx.deps)).toBe(0);
    expect(await exists(path.join(hosts, MANIFEST))).toBe(false);
  });
});
