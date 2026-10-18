import { mkdir, readFile, readdir } from "node:fs/promises";
import * as path from "node:path";

import { registerHelper, unregisterHelper } from "../../../src/helper/register/index.js";
import { createFixture, type RegisterFixture } from "./registerFixtures.js";

let fx: RegisterFixture;
afterEach(() => fx.cleanup());

async function windowsFixture(options: { queryCode?: number; failAdd?: boolean } = {}): Promise<RegisterFixture> {
  const f = await createFixture("win32", options);
  const localAppData = path.join(f.root, "local");
  const appData = path.join(f.root, "roaming");
  await mkdir(path.join(localAppData, "Google", "Chrome", "User Data"), { recursive: true });
  await mkdir(path.join(appData, "Mozilla", "Firefox"), { recursive: true });
  return { ...f, deps: { ...f.deps, env: { LOCALAPPDATA: localAppData, APPDATA: appData } } };
}

const hostFile = (f: RegisterFixture, family: string): string =>
  path.join(f.deps.dataDir, "native-messaging", `dev.labshelf.helper.${family}.json`);

describe("register on Windows", () => {
  it("writes manifests under the data folder and points HKCU keys at them", async () => {
    fx = await windowsFixture();
    expect(await registerHelper(fx.deps)).toBe(0);

    expect(JSON.parse(await readFile(hostFile(fx, "chromium"), "utf8"))).toMatchObject({
      path: "C:\\Program Files\\LabShelf\\labshelf-helper.exe",
      allowed_origins: ["chrome-extension://ghcjlkjggiffdekaneoaoklhedjeeklh/"],
    });
    expect(JSON.parse(await readFile(hostFile(fx, "firefox"), "utf8"))).toMatchObject({ allowed_extensions: ["labshelf@lucanaasser.dev"] });
    expect(fx.regCalls).toEqual([
      ["add", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\dev.labshelf.helper", "/ve", "/t", "REG_SZ", "/d", hostFile(fx, "chromium"), "/f"],
      ["add", "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\dev.labshelf.helper", "/ve", "/t", "REG_SZ", "/d", hostFile(fx, "firefox"), "/f"],
    ]);
  });

  it("skips browsers whose user data dir is absent", async () => {
    fx = await createFixture("win32", {});
    expect(await registerHelper({ ...fx.deps, env: { LOCALAPPDATA: path.join(fx.root, "none"), APPDATA: path.join(fx.root, "none2") } })).toBe(0);
    expect(fx.regCalls).toEqual([]);
  });

  it("returns 1 when reg.exe fails", async () => {
    fx = await windowsFixture({ failAdd: true });
    expect(await registerHelper(fx.deps)).toBe(1);
  });

  it("unregister deletes only keys that exist, then the manifest files", async () => {
    fx = await windowsFixture();
    await registerHelper(fx.deps);
    fx.regCalls.length = 0;

    expect(await unregisterHelper(fx.deps)).toBe(0);

    const deletes = fx.regCalls.filter((c) => c[0] === "delete");
    expect(deletes).toContainEqual(["delete", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\dev.labshelf.helper", "/f"]);
    expect(deletes.every((c) => c[1]?.endsWith("\\NativeMessagingHosts\\dev.labshelf.helper"))).toBe(true);
    expect(await readdir(path.join(fx.deps.dataDir, "native-messaging"))).toEqual([]);
  });

  it("unregister skips delete when the key is absent", async () => {
    fx = await windowsFixture({ queryCode: 1 });
    expect(await unregisterHelper(fx.deps)).toBe(0);
    expect(fx.regCalls.some((c) => c[0] === "delete")).toBe(false);
  });
});
