/** Pins that the host manifests allow exactly the extension ids the browser manifests produce. */
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";

import { BRIDGE_HOST_SPEC, installNativeHost } from "../../../../src/nativeHost/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const BROWSER_PKG = path.resolve(__dirname, "../../../../../browser");
const launch = { kind: "script", owner: "terminal", nodePath: "/usr/bin/node", hostScript: "/opt/labshelf/bridge-host.js", electronRunAsNode: false } as const;

async function readJson(file: string): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, any>;
}

/** Chrome's id: the first 32 hex digits of sha256(public key DER), each mapped 0-f to a-p. */
function chromeIdFromKey(key: string): string {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");
}

async function installedManifests(): Promise<Record<string, any>[]> {
  const home = await makeTempDir();
  await fs.mkdir(path.join(home, ".config/google-chrome"), { recursive: true });
  await fs.mkdir(path.join(home, ".mozilla"), { recursive: true });
  const result = await installNativeHost({ home, platform: "linux", logger: fakeLogger() }, BRIDGE_HOST_SPEC, launch);
  return Promise.all(result.browsers.map((b) => readJson(b.manifestPath)));
}

describe("extension ids in host manifests", () => {
  it("allows the Chrome id derived from the key in manifest.chrome.json", async () => {
    const { key } = await readJson(path.join(BROWSER_PKG, "manifest.chrome.json"));
    const [chrome] = await installedManifests();
    expect(chrome!["allowed_origins"]).toEqual([`chrome-extension://${chromeIdFromKey(key)}/`]);
  });

  it("allows the gecko id from manifest.firefox.json", async () => {
    const firefoxManifest = await readJson(path.join(BROWSER_PKG, "manifest.firefox.json"));
    const [, firefox] = await installedManifests();
    expect(firefox!["allowed_extensions"]).toEqual([firefoxManifest["browser_specific_settings"]["gecko"]["id"]]);
  });
});
