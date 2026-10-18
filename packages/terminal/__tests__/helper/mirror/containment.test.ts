import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chunksOf, createHarness, entry, errorCode, needPaths, upload, type Harness } from "./harness";

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
  await mkdir(h.outside, { recursive: true });
  await writeFile(join(h.outside, "keep.txt"), "keep");
});
afterEach(() => h.cleanup());

async function outsideIsUntouched(): Promise<void> {
  expect(await readdir(h.outside)).toEqual(["keep.txt"]);
  expect(await readFile(join(h.outside, "keep.txt"), "utf8")).toBe("keep");
}

describe("containment", () => {
  it("writes nothing outside src/ for ../ and absolute paths, in file and delete", async () => {
    await h.call("sync", { projectId: "t", files: [entry("a.tex", "A")] });
    for (const path of ["../../outside/x.tex", `${h.outside}/x.tex`, "a/../../../outside/x.tex"]) {
      expect(errorCode(await h.call("file", { projectId: "t", path, chunk: chunksOf("A")[0] }))).toBe("path");
      expect(errorCode(await h.call("delete", { projectId: "t", paths: [path] }))).toBe("path");
    }
    await outsideIsUntouched();
  });

  it("rejects a write through a symlinked parent and writes nothing in its target", async () => {
    await h.call("sync", { projectId: "t", files: [entry("dir/x.tex", "X")] });
    await symlink(h.outside, join(h.mirror.sourceDir("t"), "dir"));
    const replies = await h.call("file", { projectId: "t", path: "dir/x.tex", chunk: chunksOf("X")[0] });
    expect(errorCode(replies)).toBe("path");
    await outsideIsUntouched();
    expect(h.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ code: "path", path: "dir/x.tex" }));
  });

  it("rejects a write through a nested symlinked parent", async () => {
    await h.call("sync", { projectId: "t", files: [entry("a/b/x.tex", "X")] });
    await mkdir(join(h.mirror.sourceDir("t"), "a"));
    await symlink(h.outside, join(h.mirror.sourceDir("t"), "a/b"));
    expect(errorCode(await h.call("file", { projectId: "t", path: "a/b/x.tex", chunk: chunksOf("X")[0] }))).toBe("path");
    await outsideIsUntouched();
  });

  it("rejects a write onto a symlinked file without overwriting its target", async () => {
    await h.call("sync", { projectId: "t", files: [entry("x.tex", "X")] });
    await symlink(join(h.outside, "keep.txt"), join(h.mirror.sourceDir("t"), "x.tex"));
    expect(errorCode(await h.call("file", { projectId: "t", path: "x.tex", chunk: chunksOf("X")[0] }))).toBe("path");
    await outsideIsUntouched();
  });

  it("rejects a write when a file sits where a folder is needed", async () => {
    await h.call("sync", { projectId: "t", files: [entry("dir/x.tex", "X")] });
    await writeFile(join(h.mirror.sourceDir("t"), "dir"), "plain");
    expect(errorCode(await h.call("file", { projectId: "t", path: "dir/x.tex", chunk: chunksOf("X")[0] }))).toBe("path");
  });

  it("rejects a delete through a symlinked parent and keeps the target's files", async () => {
    await upload(h, "t", { "dir/keep.txt": "k" });
    await rm(join(h.mirror.sourceDir("t"), "dir"), { recursive: true });
    await symlink(h.outside, join(h.mirror.sourceDir("t"), "dir"));
    expect(errorCode(await h.call("delete", { projectId: "t", paths: ["dir/keep.txt"] }))).toBe("path");
    await outsideIsUntouched();
  });

  it("rejects a project folder that is a symlink out of the data folder", async () => {
    await mkdir(h.projectsRoot, { recursive: true });
    await symlink(h.outside, join(h.projectsRoot, "evil"));
    expect(errorCode(await h.call("sync", { projectId: "evil", files: [entry("a.tex", "A")] }))).toBe("path");
    await outsideIsUntouched();
  });

  it("rejects a src folder that is a symlink", async () => {
    await mkdir(join(h.projectsRoot, "t"), { recursive: true });
    await symlink(h.outside, join(h.projectsRoot, "t", "src"));
    expect(errorCode(await h.call("sync", { projectId: "t", files: [entry("a.tex", "A")] }))).toBe("path");
    await outsideIsUntouched();
  });

  it("keeps working for ordinary nested paths after a rejection", async () => {
    await h.call("sync", { projectId: "t", files: [entry("a.tex", "A")] });
    await h.call("file", { projectId: "t", path: "../x", chunk: chunksOf("A")[0] });
    expect(needPaths(await h.call("file", { projectId: "t", path: "a.tex", chunk: chunksOf("A")[0] }))).toEqual([]);
  });
});
