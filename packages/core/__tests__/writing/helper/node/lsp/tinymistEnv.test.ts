import * as path from "node:path";

import { tinymistEnv, type FontHost } from "../../../../../src/writing/helper/node/lsp/index.js";

describe("tinymistEnv", () => {
  const dataDir = path.join(path.sep, "data");
  const host = (platform: NodeJS.Platform, existing: string[] = []): FontHost => ({ homeDir: platform === "win32" ? "C:\\Users\\ana" : "/home/ana", platform, exists: (folder) => existing.includes(folder) });

  it("keeps Typst's package cache and the home folder inside the data folder", () => {
    const env = tinymistEnv(dataDir, { PATH: "/bin", LANG: "pt_BR.UTF-8", HOME: "/home/user" }, host(process.platform));
    expect(env.HOME).toBe(dataDir);
    expect(env.PATH).toBe("/bin");
    expect(env.LANG).toBe("pt_BR.UTF-8");
    expect(env.TYPST_PACKAGE_CACHE_PATH).toBe(path.join(dataDir, "typst-packages", "cache"));
    expect(env.TYPST_PACKAGE_PATH).toBe(path.join(dataDir, "typst-packages", "local"));
  });

  it("passes nothing else from the helper's environment", () => {
    const env = tinymistEnv(dataDir, { PATH: "/bin", GITHUB_TOKEN: "secret", TYPST_ROOT: "/", XDG_CACHE_HOME: "/home/user/.cache", TYPST_FONT_PATHS: "/x" }, host(process.platform));
    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH", "TYPST_PACKAGE_CACHE_PATH", "TYPST_PACKAGE_PATH", ...(process.platform === "win32" ? ["USERPROFILE"] : [])].sort());
  });

  it("passes the temporary folder through: TMPDIR on POSIX, TEMP and TMP on Windows", () => {
    const source = { TMPDIR: "/var/tmp", TEMP: "C:\\Temp", TMP: "C:\\Tmp" };
    expect(tinymistEnv(dataDir, source, host("linux"))).toMatchObject({ TMPDIR: "/var/tmp" });
    expect(tinymistEnv(dataDir, source, host("linux"))).not.toHaveProperty("TEMP");
    const windows = tinymistEnv(dataDir, source, host("win32"));
    expect(windows).toMatchObject({ TEMP: "C:\\Temp", TMP: "C:\\Tmp" });
    expect(windows).not.toHaveProperty("TMPDIR");
  });

  it("lists the macOS user font folder when it exists", () => {
    const env = tinymistEnv(dataDir, {}, host("darwin", ["/home/ana/Library/Fonts"]));
    expect(env.TYPST_FONT_PATHS).toBe("/home/ana/Library/Fonts");
  });

  it("lists the Linux user font folders that exist, joined with a colon", () => {
    const both = tinymistEnv(dataDir, {}, host("linux", ["/home/ana/.local/share/fonts", "/home/ana/.fonts"]));
    expect(both.TYPST_FONT_PATHS).toBe("/home/ana/.local/share/fonts:/home/ana/.fonts");
    const one = tinymistEnv(dataDir, {}, host("linux", ["/home/ana/.fonts"]));
    expect(one.TYPST_FONT_PATHS).toBe("/home/ana/.fonts");
  });

  it("lists the Windows user font folder under LOCALAPPDATA, falling back to the home folder", () => {
    const fonts = "D:\\Local\\Microsoft\\Windows\\Fonts";
    expect(tinymistEnv(dataDir, { LOCALAPPDATA: "D:\\Local" }, host("win32", [fonts])).TYPST_FONT_PATHS).toBe(fonts);
    const fallback = "C:\\Users\\ana\\AppData\\Local\\Microsoft\\Windows\\Fonts";
    expect(tinymistEnv(dataDir, {}, host("win32", [fallback])).TYPST_FONT_PATHS).toBe(fallback);
  });

  it("leaves TYPST_FONT_PATHS unset when no font folder exists", () => {
    expect(tinymistEnv(dataDir, {}, host("linux")).TYPST_FONT_PATHS).toBeUndefined();
  });
});
