/** Pins the file ops the host serves: chunked reads and writes, atomic commits and the LocalFileSystem semantics. */
import * as nodeFs from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BRIDGE_CHUNK_BYTES, splitFileChunks, type HostMessage } from "../../../src/bridge/index";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../support/tempDirs";
import { LibraryFileOperations } from "../../../src/bridge/node/fileOperations";
import { startBridge } from "./bridgeHarness";

afterEach(async () => {
  jest.restoreAllMocks();
  await cleanupTempDirs();
});

const THREE_MB = new Uint8Array(3 * 1024 * 1024 + 5).map((_, i) => (i * 7 + (i >> 9)) % 256);

async function library(): Promise<string> {
  const root = path.join(await makeTempDir(), "library");
  await fs.mkdir(path.join(root, "papers", "a"), { recursive: true });
  return root;
}

const chunksOf = (messages: HostMessage[]): string[] =>
  messages.flatMap((m) => ("chunk" in m ? [m.chunk] : []));

describe("bridge file operations", () => {
  it("streams a 3 MB file as chunks that fit the host message limit, then done", async () => {
    const root = await library();
    await fs.writeFile(path.join(root, "papers", "a", "paper.pdf"), THREE_MB);
    const bridge = await startBridge(root);
    await bridge.hello();
    const messages = await bridge.call({ id: 7, op: "readFile", path: "papers/a/paper.pdf" });
    expect(messages.at(-1)).toEqual({ id: 7, ok: true, result: { done: true, size: THREE_MB.length } });
    expect(chunksOf(messages)).toHaveLength(Math.ceil(THREE_MB.length / BRIDGE_CHUNK_BYTES));
    // toEqual walks a 3 MB array element by element (~10 s); compare the bytes natively.
    expect(Buffer.concat(chunksOf(messages).map((c) => Buffer.from(c, "base64"))).equals(THREE_MB)).toBe(true);
    await bridge.close();
  });

  it("writes a 3 MB file from chunks only on commit, atomically and without leftovers", async () => {
    const root = await library();
    const target = path.join(root, "papers", "b", "paper.pdf");
    const bridge = await startBridge(root);
    await bridge.hello();
    bridge.send({ id: 9, op: "writeFile", path: "papers/b/paper.pdf" });
    for (const data of splitFileChunks(THREE_MB)) { bridge.send({ id: 9, op: "chunk", data }); }
    expect((await bridge.call({ id: 10, op: "stat", path: "papers/b/paper.pdf" }))[0]).toEqual({ id: 10, ok: true, result: { stat: null } });
    expect(await pathExists(target)).toBe(false);
    expect(await bridge.call({ id: 9, op: "commit", size: THREE_MB.length })).toEqual([{ id: 9, ok: true, result: { size: THREE_MB.length } }]);
    expect((await fs.readFile(target)).equals(THREE_MB)).toBe(true);
    expect(await listFiles(root)).toEqual(["papers/b/paper.pdf"]);
    await bridge.close();
  });

  it("keeps the old content of a file until the commit replaces it", async () => {
    const root = await library();
    const target = path.join(root, "papers", "a", "metadata.yaml");
    await fs.writeFile(target, "old\n");
    const bridge = await startBridge(root);
    await bridge.hello();
    bridge.send({ id: 1, op: "writeFile", path: "papers/a/metadata.yaml" });
    bridge.send({ id: 1, op: "chunk", data: Buffer.from("new\n").toString("base64") });
    await bridge.call({ id: 2, op: "ensureDir", path: "papers" });
    expect(await fs.readFile(target, "utf8")).toBe("old\n");
    await bridge.call({ id: 1, op: "commit", size: 4 });
    expect(await fs.readFile(target, "utf8")).toBe("new\n");
    await bridge.close();
  });

  it("refuses a write outside the library before taking any chunk", async () => {
    const bridge = await startBridge(await library());
    await bridge.hello();
    expect((await bridge.call({ id: 1, op: "writeFile", path: "../x" }))[0]).toMatchObject({ ok: false, error: { code: "outsideLibrary" } });
    expect((await bridge.call({ id: 1, op: "commit", size: 0 }))[0]).toMatchObject({ ok: false, error: { code: "protocol" } });
    await bridge.close();
  });

  it("serves stat, listDir, ensureDir, rename and deleteFile with the LocalFileSystem semantics", async () => {
    const root = await library();
    await fs.writeFile(path.join(root, "papers", "a", "bib.bib"), "@x{}");
    const bridge = await startBridge(root);
    await bridge.hello();
    const [stat] = await bridge.call({ id: 1, op: "stat", path: "papers/a/bib.bib" });
    expect(stat).toMatchObject({ ok: true, result: { stat: { isFile: true, isDirectory: false, size: 4 } } });
    expect((await bridge.call({ id: 2, op: "listDir", path: "papers/missing" }))[0]).toEqual({ id: 2, ok: true, result: { names: [] } });
    expect((await bridge.call({ id: 3, op: "ensureDir", path: "projects/p/figures" }))[0]).toEqual({ id: 3, ok: true, result: {} });
    expect(await pathExists(path.join(root, "projects", "p", "figures"))).toBe(true);
    expect((await bridge.call({ id: 4, op: "rename", from: "papers/a/bib.bib", to: "papers/c/bib.bib" }))[0]).toMatchObject({ ok: true });
    expect(await fs.readFile(path.join(root, "papers", "c", "bib.bib"), "utf8")).toBe("@x{}");
    expect((await bridge.call({ id: 5, op: "rename", from: "papers/a/none", to: "papers/a/x" }))[0]).toMatchObject({ error: { code: "notFound" } });
    expect((await bridge.call({ id: 6, op: "deleteFile", path: "papers/c/bib.bib" }))[0]).toEqual({ id: 6, ok: true, result: {} });
    expect((await bridge.call({ id: 7, op: "deleteFile", path: "papers/c/bib.bib" }))[0]).toEqual({ id: 7, ok: true, result: {} });
    expect(await pathExists(path.join(root, "papers", "c", "bib.bib"))).toBe(false);
    await bridge.close();
  });

  it("deletes a folder tree in one request and treats a missing folder as done", async () => {
    const root = await library();
    await fs.mkdir(path.join(root, "papers", "a", "notes"), { recursive: true });
    await fs.writeFile(path.join(root, "papers", "a", "notes", "n.md"), "n");
    await fs.writeFile(path.join(root, "papers", "a", "metadata.yaml"), "m");
    const bridge = await startBridge(root);
    await bridge.hello();
    expect((await bridge.call({ id: 1, op: "deleteDir", path: "papers/a" }))[0]).toEqual({ id: 1, ok: true, result: {} });
    expect(await pathExists(path.join(root, "papers", "a"))).toBe(false);
    expect(await pathExists(path.join(root, "papers"))).toBe(true);
    expect((await bridge.call({ id: 2, op: "deleteDir", path: "papers/a" }))[0]).toEqual({ id: 2, ok: true, result: {} });
    await bridge.close();
  });

  it.each(["", ".", "../library", "../outside"])("refuses to delete the folder %j, which is the root or outside it", async (relative) => {
    const root = await library();
    const bridge = await startBridge(root);
    await bridge.hello();
    expect((await bridge.call({ id: 1, op: "deleteDir", path: relative }))[0]).toMatchObject({ ok: false, error: { code: "outsideLibrary" } });
    expect(await pathExists(path.join(root, "papers", "a"))).toBe(true);
    await bridge.close();
  });

  it("refuses deleteDir on a file with io and keeps the file", async () => {
    const root = await library();
    await fs.writeFile(path.join(root, "papers", "a", "bib.bib"), "@x{}");
    const bridge = await startBridge(root);
    await bridge.hello();
    expect((await bridge.call({ id: 1, op: "deleteDir", path: "papers/a/bib.bib" }))[0]).toMatchObject({ ok: false, error: { code: "io" } });
    expect(await fs.readFile(path.join(root, "papers", "a", "bib.bib"), "utf8")).toBe("@x{}");
    await bridge.close();
  });
});

describe("LibraryFileOperations confinement and atomicity", () => {
  async function withOutside(): Promise<{ root: string; outside: string; ops: LibraryFileOperations }> {
    const root = await library();
    const outside = path.join(path.dirname(root), "outside");
    await fs.mkdir(outside);
    return { root, outside, ops: new LibraryFileOperations(root) };
  }

  it("fails a cross-volume commit with io, leaving no temp file and the target untouched", async () => {
    const { root, ops } = await withOutside();
    const target = path.join(root, "papers", "a", "metadata.yaml");
    await fs.writeFile(target, "old\n");
    jest.spyOn(nodeFs.promises, "rename").mockRejectedValueOnce(Object.assign(new Error("cross-device"), { code: "EXDEV" }));
    await expect(ops.writeFile("papers/a/metadata.yaml", Buffer.from("new\n"))).rejects.toMatchObject({ code: "io" });
    expect(await fs.readFile(target, "utf8")).toBe("old\n");
    expect(await listFiles(root)).toEqual(["papers/a/metadata.yaml"]);
  });

  it("refuses to stage a write in a .research folder that links outside the library", async () => {
    const { root, outside, ops } = await withOutside();
    await fs.symlink(outside, path.join(root, ".research"));
    await expect(ops.writeFile("papers/a/x.txt", Buffer.from("x"))).rejects.toMatchObject({ code: "outsideLibrary" });
    expect(await listFiles(outside)).toEqual([]);
  });

  it("refuses a commit whose folder is swapped to an escaping symlink before the rename", async () => {
    const { root, outside, ops } = await withOutside();
    const realOpen = nodeFs.promises.open;
    jest.spyOn(nodeFs.promises, "open").mockImplementationOnce(async (...args: Parameters<typeof realOpen>) => {
      await fs.rm(path.join(root, "papers", "a"), { recursive: true });
      await fs.symlink(outside, path.join(root, "papers", "a"));
      return realOpen(...args);
    });
    await expect(ops.writeFile("papers/a/x.txt", Buffer.from("x"))).rejects.toMatchObject({ code: "outsideLibrary" });
    expect(await listFiles(outside)).toEqual([]);
  });

  it("refuses a rename whose target folder is swapped to an escaping symlink before the rename", async () => {
    const { root, outside, ops } = await withOutside();
    await fs.writeFile(path.join(root, "papers", "a", "x.txt"), "x");
    await fs.mkdir(path.join(root, "papers", "b"));
    const realMkdir = nodeFs.promises.mkdir;
    jest.spyOn(nodeFs.promises, "mkdir").mockImplementationOnce(async (...args: Parameters<typeof realMkdir>) => {
      await fs.rm(path.join(root, "papers", "b"), { recursive: true });
      await fs.symlink(outside, path.join(root, "papers", "b"));
      return realMkdir(...args);
    });
    await expect(ops.rename("papers/a/x.txt", "papers/b/x.txt")).rejects.toMatchObject({ code: "outsideLibrary" });
    expect(await listFiles(outside)).toEqual([]);
  });

  it("stats, lists and deletes symlinks as entries that are neither file nor folder", async () => {
    const { root, outside, ops } = await withOutside();
    const papers = path.join(root, "papers");
    await fs.writeFile(path.join(outside, "secret.txt"), "s");
    await fs.symlink(outside, path.join(papers, "escape"));
    await fs.symlink(path.join(outside, "gone"), path.join(papers, "dangling"));
    await fs.symlink(path.join(papers, "a"), path.join(papers, "alias"));
    expect((await ops.listDir("papers")).names.sort()).toEqual(["a", "alias", "dangling", "escape"]);
    for (const name of ["escape", "dangling", "alias"]) {
      expect((await ops.stat(`papers/${name}`)).stat).toMatchObject({ isFile: false, isDirectory: false });
      await ops.deleteFile(`papers/${name}`);
    }
    expect((await ops.listDir("papers")).names).toEqual(["a"]);
    expect(await fs.readFile(path.join(outside, "secret.txt"), "utf8")).toBe("s");
  });

  it("deleteDir removes symlink entries and never their targets", async () => {
    const { root, outside, ops } = await withOutside();
    const papers = path.join(root, "papers");
    await fs.writeFile(path.join(outside, "secret.txt"), "s");
    await fs.writeFile(path.join(papers, "a", "keep.txt"), "k");
    await fs.symlink(outside, path.join(papers, "escape"));
    await fs.symlink(path.join(papers, "a"), path.join(papers, "alias"));
    await fs.mkdir(path.join(papers, "b"));
    await fs.symlink(outside, path.join(papers, "b", "inner"));
    for (const name of ["escape", "alias", "b"]) await ops.deleteDir(`papers/${name}`);
    expect((await ops.listDir("papers")).names).toEqual(["a"]);
    expect(await fs.readFile(path.join(papers, "a", "keep.txt"), "utf8")).toBe("k");
    expect(await fs.readFile(path.join(outside, "secret.txt"), "utf8")).toBe("s");
  });

  it("refuses deleteDir through a folder that links outside the library", async () => {
    const { root, outside, ops } = await withOutside();
    await fs.mkdir(path.join(outside, "x"));
    await fs.symlink(outside, path.join(root, "papers", "escape"));
    await expect(ops.deleteDir("papers/escape/x")).rejects.toMatchObject({ code: "outsideLibrary" });
    expect(await pathExists(path.join(outside, "x"))).toBe(true);
  });

  it("refuses reads and writes through an escaping symlink", async () => {
    const { root, outside, ops } = await withOutside();
    await fs.writeFile(path.join(outside, "secret.txt"), "s");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "papers", "link.txt"));
    await expect(ops.readFile("papers/link.txt")).rejects.toMatchObject({ code: "outsideLibrary" });
    await expect(ops.writeFile("papers/link.txt", Buffer.from("x"))).rejects.toMatchObject({ code: "outsideLibrary" });
    expect(await fs.readFile(path.join(outside, "secret.txt"), "utf8")).toBe("s");
  });
});

describe("paperCount", () => {
  it("counts papers at any folder depth, does not descend into a paper and ignores symlinks", async () => {
    const root = await library();
    const outside = path.join(path.dirname(root), "outside");
    await fs.mkdir(outside);
    const ops = new LibraryFileOperations(root);
    const paper = async (...parts: string[]): Promise<void> => {
      await fs.mkdir(path.join(root, "papers", ...parts), { recursive: true });
      await fs.writeFile(path.join(root, "papers", ...parts, "metadata.yaml"), "title: x\n");
    };
    await paper("top");
    await paper("folder", "sub", "deep");
    await paper("folder", "sibling");
    await paper("top", "inside-a-paper");
    await fs.mkdir(path.join(outside, "linked"));
    await fs.writeFile(path.join(outside, "linked", "metadata.yaml"), "title: y\n");
    await fs.symlink(path.join(outside, "linked"), path.join(root, "papers", "link"));
    expect(await ops.paperCount()).toBe(3);
  });
});
