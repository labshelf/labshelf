// Hidden tests of spec 4.2: the chrome-headless-shell pin, one Chrome for Testing Stable version for four platforms.
import { chromiumPin } from "../../../src/decks/node/chromiumPin.js";

const CFT = { "darwin-arm64": "mac-arm64", "darwin-x64": "mac-x64", "linux-x64": "linux64", "win32-x64": "win64" } as const;

describe("chromiumPin", () => {
  it("4.2a has a dotted Chrome version", () => {
    expect(chromiumPin().version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it("4.2a has exactly the four platform keys and no linux-arm64", () => {
    const keys = Object.keys(chromiumPin().platforms).sort();
    expect(keys).toEqual(Object.keys(CFT).sort());
    expect(Object.hasOwn(chromiumPin().platforms, "linux-arm64")).toBe(false);
  });

  it("4.2a points every entry at the Chrome for Testing zip of its platform and version", () => {
    const pin = chromiumPin();
    for (const [key, cft] of Object.entries(CFT)) {
      const entry = pin.platforms[key as keyof typeof CFT];
      expect(entry?.url).toBe(`https://storage.googleapis.com/chrome-for-testing-public/${pin.version}/${cft}/chrome-headless-shell-${cft}.zip`);
    }
  });

  it("4.2a gives every entry a 64 lowercase hex sha256, all different", () => {
    const hashes = Object.values(chromiumPin().platforms).map((entry) => entry?.sha256);
    for (const hash of hashes) { expect(hash).toMatch(/^[0-9a-f]{64}$/); }
    expect(new Set(hashes).size).toBe(4);
  });

  it("4.2a names the executable inside the zip, with .exe on win64", () => {
    const pin = chromiumPin();
    for (const [key, cft] of Object.entries(CFT)) {
      const suffix = key === "win32-x64" ? ".exe" : "";
      expect(pin.platforms[key as keyof typeof CFT]?.executable).toBe(`chrome-headless-shell-${cft}/chrome-headless-shell${suffix}`);
    }
  });

  it("4.2a returns a fresh copy on each call", () => {
    const first = chromiumPin();
    const version = first.version;
    const url = first.platforms["linux-x64"]?.url;
    first.version = "0.0.0.0";
    if (first.platforms["linux-x64"]) { first.platforms["linux-x64"].url = "https://example.test/changed.zip"; }
    delete first.platforms["win32-x64"];
    const second = chromiumPin();
    expect(second.version).toBe(version);
    expect(second.platforms["linux-x64"]?.url).toBe(url);
    expect(second.platforms["win32-x64"]).toBeDefined();
  });
});
