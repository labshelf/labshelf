/** Pins that bridge paths resolve only inside the library root. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { assertInLibrary, isInsideBase, resolveInLibrary, resolveParentInLibrary } from "../../../src/bridge/node/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

async function library(): Promise<{ root: string; outside: string }> {
  const base = await makeTempDir();
  const root = path.join(base, "library");
  const outside = path.join(base, "outside");
  await fs.mkdir(path.join(root, "papers"), { recursive: true });
  await fs.mkdir(outside);
  return { root, outside };
}

describe("resolveInLibrary", () => {
  it("resolves relative paths, existing or not, under the root", async () => {
    const { root } = await library();
    await expect(resolveInLibrary(root, "papers/a/metadata.yaml")).resolves.toBe(path.join(root, "papers", "a", "metadata.yaml"));
    await expect(resolveInLibrary(root, "")).resolves.toBe(root);
    await expect(resolveInLibrary(root, "./papers/./b")).resolves.toBe(path.join(root, "papers", "b"));
  });

  it.each(["papers/CON", "papers/nul.txt", "Aux/x", "papers/a/com1.tar.gz", "lpt9 .pdf", "papers/prn\\x"])(
    "refuses the Windows device name in %j on every platform",
    async (relative) => {
      const { root } = await library();
      await expect(resolveInLibrary(root, relative)).rejects.toMatchObject({ code: "outsideLibrary" });
      await expect(resolveParentInLibrary(root, relative)).rejects.toMatchObject({ code: "outsideLibrary" });
    },
  );

  it("accepts names that only start like a device name", async () => {
    const { root } = await library();
    await expect(resolveInLibrary(root, "papers/console/com10.txt")).resolves.toBe(path.join(root, "papers", "console", "com10.txt"));
  });

  it.each(["../outside/x", "papers/../../outside", "papers\\..\\..\\x", "/etc/passwd", "C:\\Windows", "c:x", "a\0b"])(
    "refuses %j as outside the library",
    async (relative) => {
      const { root } = await library();
      await expect(resolveInLibrary(root, relative)).rejects.toMatchObject({ code: "outsideLibrary" });
    },
  );

  it("refuses a symlink that escapes the root, for the link and for paths through it", async () => {
    const { root, outside } = await library();
    await fs.writeFile(path.join(outside, "secret.txt"), "s");
    await fs.symlink(outside, path.join(root, "papers", "escape"));
    await expect(resolveInLibrary(root, "papers/escape")).rejects.toMatchObject({ code: "outsideLibrary" });
    await expect(resolveInLibrary(root, "papers/escape/secret.txt")).rejects.toMatchObject({ code: "outsideLibrary" });
    await expect(resolveInLibrary(root, "papers/escape/new/file.txt")).rejects.toMatchObject({ code: "outsideLibrary" });
  });

  it("refuses a dangling symlink, whose target may be created outside", async () => {
    const { root, outside } = await library();
    await fs.symlink(path.join(outside, "later.txt"), path.join(root, "papers", "dangling"));
    await expect(resolveInLibrary(root, "papers/dangling")).rejects.toMatchObject({ code: "outsideLibrary" });
  });

  it("accepts a symlink that stays inside the root", async () => {
    const { root } = await library();
    await fs.mkdir(path.join(root, "papers", "real"));
    await fs.symlink(path.join(root, "papers", "real"), path.join(root, "papers", "alias"));
    await expect(resolveInLibrary(root, "papers/alias/x")).resolves.toBe(path.join(root, "papers", "alias", "x"));
  });

  it("reports a missing root as noLibrary", async () => {
    const { root } = await library();
    await expect(resolveInLibrary(path.join(root, "gone"), "papers")).rejects.toMatchObject({ code: "noLibrary" });
  });
});

describe("isInsideRoot", () => {
  it.each([
    ["C:\\Lib", "C:\\Lib", true],
    ["C:\\Lib", "c:\\lib\\Paper", true],
    ["C:\\", "C:\\x\\y", true],
    ["C:\\Lib", "C:\\Library\\x", false],
    ["C:\\Lib", "C:\\", false],
    ["C:\\Lib", "D:\\Lib\\x", false],
    ["C:\\Lib", "C:\\Lib\\..x", true],
  ])("win32: %j contains %j is %j", (base, real, inside) => {
    expect(isInsideBase(base, real, path.win32)).toBe(inside);
  });

  it.each([
    ["/", "/x", true],
    ["/lib", "/lib", true],
    ["/lib", "/Lib/x", false],
    ["/lib", "/library", false],
    ["/lib", "/lib/..x", true],
    ["/lib", "/", false],
  ])("posix: %j contains %j is %j", (base, real, inside) => {
    expect(isInsideBase(base, real, path.posix)).toBe(inside);
  });
});

describe("resolveParentInLibrary and assertInLibrary", () => {
  it("returns the real parent and the entry name, even when the parent does not exist yet", async () => {
    const { root } = await library();
    const realRoot = await fs.realpath(root);
    await expect(resolveParentInLibrary(root, "papers/new/a.pdf")).resolves.toEqual({
      realRoot,
      realParent: path.join(realRoot, "papers", "new"),
      name: "a.pdf",
    });
  });

  it("refuses a parent that escapes through a symlink", async () => {
    const { root, outside } = await library();
    await fs.symlink(outside, path.join(root, "papers", "escape"));
    await expect(resolveParentInLibrary(root, "papers/escape/x")).rejects.toMatchObject({ code: "outsideLibrary" });
  });

  it("refuses a folder swapped to an escaping symlink after it was resolved", async () => {
    const { root, outside } = await library();
    const { realRoot, realParent } = await resolveParentInLibrary(root, "papers/a/x");
    await expect(assertInLibrary(realRoot, realParent)).resolves.toBeUndefined();
    await fs.symlink(outside, path.join(root, "papers", "a"));
    await expect(assertInLibrary(realRoot, realParent)).rejects.toMatchObject({ code: "outsideLibrary" });
  });
});
