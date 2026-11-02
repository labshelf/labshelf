// Hidden tests of spec 4.1: findChromium in D11 order (env, PATH names, per-OS install paths, managed) with injected probes.
import { findChromium, type FindChromiumOptions } from "../../../src/decks/node/findChromium.js";

const HOME = "/Users/someone";

/** Options with no env override, no PATH hits and no existing files, overridden per test. */
function options(overrides: Partial<FindChromiumOptions> & { hits?: Record<string, string>; files?: string[] } = {}): FindChromiumOptions {
  const { hits = {}, files = [], ...rest } = overrides;
  const existing = new Set(files);
  return {
    env: {},
    platform: "linux",
    homeDir: HOME,
    exists: async (p: string) => existing.has(p),
    which: async (name: string) => hits[name],
    ...rest,
  };
}

const ALL_NAMES = [
  "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge",
  "microsoft-edge-stable", "brave-browser", "chrome", "msedge", "brave",
];

function hitsFrom(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, `/bin/${name}`]));
}

describe("findChromium", () => {
  it("4.1a uses LABSHELF_CHROMIUM when it is set and exists, before PATH and install paths", async () => {
    const found = await findChromium(options({
      env: { LABSHELF_CHROMIUM: "/opt/my/chrome" },
      files: ["/opt/my/chrome", "/usr/bin/google-chrome"],
      hits: hitsFrom(ALL_NAMES),
      managed: async () => "/managed/chrome",
    }));
    expect(found).toEqual({ path: "/opt/my/chrome", source: "env" });
  });

  it("4.1a skips a LABSHELF_CHROMIUM path that does not exist", async () => {
    const found = await findChromium(options({
      env: { LABSHELF_CHROMIUM: "/opt/missing/chrome" },
      hits: { chromium: "/bin/chromium" },
    }));
    expect(found).toEqual({ path: "/bin/chromium", source: "system" });
  });

  it("4.1a takes the first PATH name in the stated order", async () => {
    for (let i = 0; i < ALL_NAMES.length; i++) {
      const found = await findChromium(options({ hits: hitsFrom(ALL_NAMES.slice(i)) }));
      expect(found).toEqual({ path: `/bin/${ALL_NAMES[i]}`, source: "system" });
    }
  });

  it("4.1a prefers a PATH name over an install path", async () => {
    const found = await findChromium(options({ hits: { brave: "/bin/brave" }, files: ["/usr/bin/google-chrome"] }));
    expect(found).toEqual({ path: "/bin/brave", source: "system" });
  });

  it("4.1a probes the linux install paths in order", async () => {
    const linux = [
      "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
      "/snap/bin/chromium", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser",
    ];
    for (let i = 0; i < linux.length; i++) {
      const found = await findChromium(options({ platform: "linux", files: linux.slice(i) }));
      expect(found).toEqual({ path: linux[i], source: "system" });
    }
  });

  it("4.1a uses the linux install paths on other non-darwin, non-win32 platforms", async () => {
    const found = await findChromium(options({ platform: "freebsd", files: ["/snap/bin/chromium"] }));
    expect(found).toEqual({ path: "/snap/bin/chromium", source: "system" });
  });

  it("4.1a probes the darwin apps under /Applications before ~/Applications, in app order", async () => {
    const apps = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "Brave Browser.app/Contents/MacOS/Brave Browser",
      "Chromium.app/Contents/MacOS/Chromium",
    ];
    const ordered = [
      ...apps.map((app) => `/Applications/${app}`),
      ...apps.map((app) => `${HOME}/Applications/${app}`),
    ];
    for (let i = 0; i < ordered.length; i++) {
      const found = await findChromium(options({ platform: "darwin", files: ordered.slice(i) }));
      expect(found).toEqual({ path: ordered[i], source: "system" });
    }
  });

  it("4.1a does not probe darwin paths on linux", async () => {
    const found = await findChromium(options({
      platform: "linux",
      files: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    }));
    expect(found).toBeUndefined();
  });

  it("4.1a probes the win32 install paths under PROGRAMFILES, PROGRAMFILES(X86) then LOCALAPPDATA", async () => {
    const env = {
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      LocalAppData: "C:\\Users\\someone\\AppData\\Local",
    };
    const tails = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Chromium\\Application\\chrome.exe",
    ];
    const ordered = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LocalAppData]
      .flatMap((base) => tails.map((tail) => `${base}\\${tail}`));
    for (let i = 0; i < ordered.length; i++) {
      const found = await findChromium(options({ platform: "win32", env, files: ordered.slice(i) }));
      expect(found).toEqual({ path: ordered[i], source: "system" });
    }
  });

  it("4.1a skips win32 bases that are not set", async () => {
    const found = await findChromium(options({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local" },
      files: ["C:\\Users\\someone\\AppData\\Local\\Chromium\\Application\\chrome.exe"],
    }));
    expect(found).toEqual({ path: "C:\\Users\\someone\\AppData\\Local\\Chromium\\Application\\chrome.exe", source: "system" });
  });

  it("4.1a falls back to managed when nothing on the system is found", async () => {
    const found = await findChromium(options({
      env: { LABSHELF_CHROMIUM: "/opt/missing/chrome" },
      managed: async () => "/tools/chrome/chrome-headless-shell",
    }));
    expect(found).toEqual({ path: "/tools/chrome/chrome-headless-shell", source: "managed" });
  });

  it("4.1a prefers a system Chromium over managed", async () => {
    const found = await findChromium(options({
      files: ["/usr/bin/chromium"],
      managed: async () => "/tools/chrome/chrome-headless-shell",
    }));
    expect(found).toEqual({ path: "/usr/bin/chromium", source: "system" });
  });

  it("4.1a gives undefined when managed gives no path", async () => {
    expect(await findChromium(options({ managed: async () => undefined }))).toBeUndefined();
  });

  it("4.1a gives undefined when nothing is found and no managed is given", async () => {
    expect(await findChromium(options())).toBeUndefined();
  });
});
