import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { CHUNK_MAX_BYTES } from "../../../../../src/writing/helper/index.js";

import { chunksOf, createHarness, entry, errorCode, needPaths, sha256, type Harness } from "./harness";

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(() => h.cleanup());

const read = (project: string, path: string) => readFile(join(h.mirror.sourceDir(project), path), "utf8");

describe("file", () => {
  it("writes a file once its chunk arrives and answers only once no file is needed", async () => {
    await h.call("sync", { projectId: "t", files: [entry("a.tex", "AA"), entry("d/b.tex", "BB")] });
    const first = await h.call("file", { projectId: "t", path: "a.tex", chunk: chunksOf("AA")[0] });
    expect(needPaths(first)).toBeUndefined();
    expect(await read("t", "a.tex")).toBe("AA");
    const last = await h.call("file", { projectId: "t", path: "d/b.tex", chunk: chunksOf("BB")[0] });
    expect(needPaths(last)).toEqual([]);
    expect(await read("t", "d/b.tex")).toBe("BB");
  });

  it("assembles several chunks and an empty file", async () => {
    const big = Buffer.alloc(CHUNK_MAX_BYTES * 2 + 10, "x");
    await h.call("sync", { projectId: "t", files: [{ path: "big.bin", sha256: sha256(big), size: big.length }, entry("empty.tex", "")] });
    const chunks = chunksOf(big);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks.slice(0, 2)) {
      expect(await h.call("file", { projectId: "t", path: "big.bin", chunk })).toEqual([]);
    }
    await h.call("file", { projectId: "t", path: "big.bin", chunk: chunks[2] });
    const done = await h.call("file", { projectId: "t", path: "empty.tex", chunk: chunksOf("")[0] });
    expect(needPaths(done)).toEqual([]);
    expect((await readFile(join(h.mirror.sourceDir("t"), "big.bin"))).equals(big)).toBe(true);
    expect(await read("t", "empty.tex")).toBe("");
  });

  it("rejects content whose SHA-256 differs, writes nothing and keeps the file needed", async () => {
    await h.call("sync", { projectId: "t", files: [{ path: "a.tex", sha256: sha256("good"), size: 4 }] });
    const replies = await h.call("file", { projectId: "t", path: "a.tex", chunk: chunksOf("evil")[0] });
    expect(errorCode(replies)).toBe("invalid-field");
    await expect(readdir(h.mirror.sourceDir("t"))).resolves.toEqual([]);
    expect(h.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ path: "a.tex" }));
    const retry = await h.call("file", { projectId: "t", path: "a.tex", chunk: chunksOf("good")[0] });
    expect(needPaths(retry)).toEqual([]);
    expect(await read("t", "a.tex")).toBe("good");
  });

  it("rejects a file the last sync did not request", async () => {
    await h.call("sync", { projectId: "t", files: [entry("a.tex", "A")] });
    expect(errorCode(await h.call("file", { projectId: "t", path: "other.tex", chunk: chunksOf("A")[0] }))).toBe("invalid-field");
    expect(errorCode(await h.call("file", { projectId: "none", path: "a.tex", chunk: chunksOf("A")[0] }))).toBe("invalid-field");
  });

  it("rejects a chunk count that does not match the declared size", async () => {
    await h.call("sync", { projectId: "t", files: [entry("a.tex", "A")] });
    const two = [{ index: 0, count: 2, data: "QQ==" }];
    expect(errorCode(await h.call("file", { projectId: "t", path: "a.tex", chunk: two[0] }))).toBe("invalid-field");
  });

  it("rejects a gap, then accepts the file restarted from chunk 0", async () => {
    const big = Buffer.alloc(CHUNK_MAX_BYTES + 1, "y");
    await h.call("sync", { projectId: "t", files: [{ path: "b.bin", sha256: sha256(big), size: big.length }] });
    const chunks = chunksOf(big);
    expect(errorCode(await h.call("file", { projectId: "t", path: "b.bin", chunk: chunks[1] }))).toBe("invalid-field");
    await h.call("file", { projectId: "t", path: "b.bin", chunk: chunks[0] });
    const done = await h.call("file", { projectId: "t", path: "b.bin", chunk: chunks[1] });
    expect(needPaths(done)).toEqual([]);
  });

  it("rejects an invalid path or project id", async () => {
    expect(errorCode(await h.call("file", { projectId: "t", path: "../a", chunk: chunksOf("A")[0] }))).toBe("path");
    expect(errorCode(await h.call("file", { projectId: "../t", path: "a", chunk: chunksOf("A")[0] }))).toBe("project-id");
  });

  it("leaves no temporary file in the source folder", async () => {
    await h.call("sync", { projectId: "t", files: [entry("a.tex", "A")] });
    await h.call("file", { projectId: "t", path: "a.tex", chunk: chunksOf("A")[0] });
    expect(await readdir(h.mirror.sourceDir("t"))).toEqual(["a.tex"]);
  });

  it("does not request an unchanged file again after a restart of the mirror", async () => {
    await h.call("sync", { projectId: "t", files: [entry("a.tex", "A")] });
    await h.call("file", { projectId: "t", path: "a.tex", chunk: chunksOf("A")[0] });
    const { createProjectMirror } = await import("../../../../../src/writing/helper/node/mirror/index");
    const fresh = createProjectMirror({ projectsRoot: h.projectsRoot, logger: h.logger as never });
    const sent: unknown[] = [];
    await fresh.sync({ v: 1, id: "9", type: "sync", projectId: "t", files: [entry("a.tex", "A")] }, (m) => sent.push(m));
    expect(sent).toEqual([{ v: 1, id: "9", type: "need", paths: [] }]);
  });
});
