import { mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MAX_SYNC_FILES, MAX_SYNC_TOTAL_BYTES } from "@labshelf/core/helper";

import { createHarness, entry, errorCode, needPaths, sha256, upload, type Harness } from "./harness";

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

describe("sync", () => {
  it("requests every path of a project the helper has never seen", async () => {
    const replies = await h.call("sync", { projectId: "thesis", files: [entry("main.tex", "a"), entry("ch/one.tex", "b")] });
    expect(needPaths(replies)).toEqual(["main.tex", "ch/one.tex"]);
    expect(replies[0]).toMatchObject({ v: 1, id: "1", type: "need" });
  });

  it("requests only the files that are absent or whose SHA-256 differs", async () => {
    await upload(h, "thesis", { "main.tex": "a", "ch/one.tex": "b", "refs.bib": "c" });
    const replies = await h.call("sync", {
      projectId: "thesis",
      files: [entry("main.tex", "a"), entry("ch/one.tex", "changed"), entry("refs.bib", "c"), entry("new.tex", "n")],
    });
    expect(needPaths(replies)).toEqual(["ch/one.tex", "new.tex"]);
  });

  it("requests a file whose bytes changed on disk even when the size and the index are unchanged", async () => {
    await upload(h, "thesis", { "main.tex": "aaaa" });
    const target = join(h.mirror.sourceDir("thesis"), "main.tex");
    const before = await stat(target);
    await writeFile(target, "bbbb");
    await utimes(target, before.atime, new Date(before.mtimeMs + 5000));
    const replies = await h.call("sync", { projectId: "thesis", files: [entry("main.tex", "aaaa")] });
    expect(needPaths(replies)).toEqual(["main.tex"]);
  });

  it("deletes mirror files absent from the list and prunes their empty parents", async () => {
    await upload(h, "thesis", { "main.tex": "a", "deep/er/old.tex": "b", "keep/x.tex": "c" });
    const replies = await h.call("sync", { projectId: "thesis", files: [entry("main.tex", "a"), entry("keep/x.tex", "c")] });
    expect(needPaths(replies)).toEqual([]);
    const src = h.mirror.sourceDir("thesis");
    expect((await readdir(src)).sort()).toEqual(["keep", "main.tex"]);
  });

  it("removes a symlink found in the mirror without touching its target", async () => {
    await upload(h, "thesis", { "main.tex": "a" });
    await mkdir(h.outside, { recursive: true });
    await writeFile(join(h.outside, "secret.txt"), "s");
    const { symlink } = await import("node:fs/promises");
    await symlink(h.outside, join(h.mirror.sourceDir("thesis"), "link"));
    await h.call("sync", { projectId: "thesis", files: [entry("main.tex", "a")] });
    expect(await readdir(h.mirror.sourceDir("thesis"))).toEqual(["main.tex"]);
    expect(await readFile(join(h.outside, "secret.txt"), "utf8")).toBe("s");
  });

  it("keeps projects apart", async () => {
    await upload(h, "one", { "main.tex": "a" });
    const replies = await h.call("sync", { projectId: "two", files: [entry("main.tex", "a")] });
    expect(needPaths(replies)).toEqual(["main.tex"]);
  });

  it("rejects an invalid project id with project-id and logs it", async () => {
    for (const projectId of ["../x", "A", "a--b", "", "a/b"]) {
      expect(errorCode(await h.call("sync", { projectId, files: [] }))).toBe("project-id");
    }
    expect(h.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ code: "project-id" }));
  });

  it("rejects unsafe paths with path and writes nothing", async () => {
    for (const path of ["../x.tex", "/etc/passwd", "a/../../x", "a\\b", "C:x", "a//b", "./x", ""]) {
      const replies = await h.call("sync", { projectId: "thesis", files: [{ path, sha256: sha256("a"), size: 1 }] });
      expect(errorCode(replies)).toBe("path");
    }
    await expect(readdir(h.projectsRoot)).rejects.toThrow();
  });

  it("rejects a list where a file is also a folder of another entry", async () => {
    const replies = await h.call("sync", { projectId: "thesis", files: [entry("a", "x"), entry("a/b.tex", "y")] });
    expect(errorCode(replies)).toBe("path");
  });

  it("rejects duplicate paths, bad hashes and bad sizes with invalid-field", async () => {
    const dup = [entry("a.tex", "x"), entry("a.tex", "x")];
    expect(errorCode(await h.call("sync", { projectId: "t", files: dup }))).toBe("invalid-field");
    expect(errorCode(await h.call("sync", { projectId: "t", files: [{ path: "a", sha256: "ABC", size: 1 }] }))).toBe("invalid-field");
    expect(errorCode(await h.call("sync", { projectId: "t", files: [{ path: "a", sha256: sha256("a"), size: -1 }] }))).toBe("invalid-field");
    expect(errorCode(await h.call("sync", { projectId: "t", files: [{ path: "a", sha256: sha256("a"), size: 1.5 }] }))).toBe("invalid-field");
  });

  it("enforces the file count and total size limits with limit", async () => {
    const many = Array.from({ length: MAX_SYNC_FILES + 1 }, (_, i) => ({ path: `f${i}.tex`, sha256: sha256("a"), size: 1 }));
    expect(errorCode(await h.call("sync", { projectId: "t", files: many }))).toBe("limit");
    const big = [
      { path: "a.bin", sha256: sha256("a"), size: MAX_SYNC_TOTAL_BYTES },
      { path: "b.bin", sha256: sha256("b"), size: 1 },
    ];
    expect(errorCode(await h.call("sync", { projectId: "t", files: big }))).toBe("limit");
    expect(needPaths(await h.call("sync", { projectId: "t", files: [big[0]] }))).toEqual(["a.bin"]);
  });
});
