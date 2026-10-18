import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { MAX_SYNC_FILES } from "@labshelf/core/helper";

import { createHarness, entry, errorCode, needPaths, upload, type Harness } from "./harness";

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe("delete", () => {
  it("removes the listed files and their empty parents only", async () => {
    await upload(h, "t", { "main.tex": "a", "a/b/c.tex": "c", "a/keep.tex": "k", "x/y/z.tex": "z" });
    const replies = await h.call("delete", { projectId: "t", paths: ["a/b/c.tex", "x/y/z.tex"] });
    expect(needPaths(replies)).toEqual([]);
    const src = h.mirror.sourceDir("t");
    expect((await readdir(src)).sort()).toEqual(["a", "main.tex"]);
    expect(await readdir(join(src, "a"))).toEqual(["keep.tex"]);
  });

  it("never removes src itself or a non-empty parent", async () => {
    await upload(h, "t", { "only.tex": "a" });
    await h.call("delete", { projectId: "t", paths: ["only.tex"] });
    expect(await readdir(h.mirror.sourceDir("t"))).toEqual([]);
  });

  it("ignores a missing file and refuses a listed folder without removing it", async () => {
    await upload(h, "t", { "d/f.tex": "f" });
    expect(needPaths(await h.call("delete", { projectId: "t", paths: ["nope.tex"] }))).toEqual([]);
    expect(errorCode(await h.call("delete", { projectId: "t", paths: ["d"] }))).toBe("path");
    expect(await readdir(join(h.mirror.sourceDir("t"), "d"))).toEqual(["f.tex"]);
  });

  it("answers for a project the helper has never seen without creating it", async () => {
    expect(needPaths(await h.call("delete", { projectId: "ghost", paths: ["a.tex"] }))).toEqual([]);
    await expect(readdir(join(h.projectsRoot, "ghost"))).rejects.toThrow();
  });

  it("requests a deleted file again at the next sync", async () => {
    await upload(h, "t", { "a.tex": "A" });
    await h.call("delete", { projectId: "t", paths: ["a.tex"] });
    expect(needPaths(await h.call("sync", { projectId: "t", files: [entry("a.tex", "A")] }))).toEqual(["a.tex"]);
  });

  it("rejects a bad path and removes nothing from the same message", async () => {
    await upload(h, "t", { "a.tex": "A" });
    expect(errorCode(await h.call("delete", { projectId: "t", paths: ["a.tex", "../b"] }))).toBe("path");
    expect(await readdir(h.mirror.sourceDir("t"))).toEqual(["a.tex"]);
  });

  it("rejects more paths than the limit and a bad project id", async () => {
    const paths = Array.from({ length: MAX_SYNC_FILES + 1 }, (_, i) => `f${i}`);
    expect(errorCode(await h.call("delete", { projectId: "t", paths }))).toBe("limit");
    expect(errorCode(await h.call("delete", { projectId: "../t", paths: ["a"] }))).toBe("project-id");
  });

  it("sourceDir names the project's src folder and refuses an unsafe id", async () => {
    expect(h.mirror.sourceDir("t")).toBe(join(h.projectsRoot, "t", "src"));
    expect(() => h.mirror.sourceDir("../t")).toThrow();
  });
});
