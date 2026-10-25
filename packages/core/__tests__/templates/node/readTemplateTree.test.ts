/** Verifies reading a template folder from disk and refusing unsafe trees. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";
import { readTemplateTree } from "../../../src/templates/node/index.js";

afterEach(cleanupTempDirs);

async function put(root: string, rel: string, content: string | Uint8Array = "x"): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

describe("readTemplateTree", () => {
  it("returns every file with a slash-joined relative path, sorted, with its bytes", async () => {
    const dir = await makeTempDir();
    await put(dir, "main.tex", "hello");
    await put(dir, "sections/b.tex", "b");
    await put(dir, "sections/a.tex", "a");
    await put(dir, "img/logo.bin", new Uint8Array([0, 1, 2, 255]));
    const files = await readTemplateTree(dir);
    expect(files.map((f) => f.path)).toEqual(["img/logo.bin", "main.tex", "sections/a.tex", "sections/b.tex"]);
    expect(Array.from(files[0]!.bytes)).toEqual([0, 1, 2, 255]);
    expect(Buffer.from(files[1]!.bytes).toString()).toBe("hello");
  });

  it("returns an empty list for an empty folder", async () => {
    expect(await readTemplateTree(await makeTempDir())).toEqual([]);
  });

  it("rejects a missing folder", async () => {
    const dir = await makeTempDir();
    await expect(readTemplateTree(path.join(dir, "nope"))).rejects.toThrow();
  });

  it("rejects a symlink to a file, naming it", async () => {
    const dir = await makeTempDir();
    const outside = await makeTempDir();
    await put(outside, "secret.txt");
    await put(dir, "main.tex");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(dir, "link.txt"));
    await expect(readTemplateTree(dir)).rejects.toThrow(/link\.txt/);
  });

  it("rejects a symlink to a directory", async () => {
    const dir = await makeTempDir();
    const outside = await makeTempDir();
    await put(dir, "main.tex");
    await fs.symlink(outside, path.join(dir, "linked-dir"));
    await expect(readTemplateTree(dir)).rejects.toThrow(/linked-dir/);
  });

  it("rejects a dangling symlink", async () => {
    const dir = await makeTempDir();
    await fs.symlink(path.join(dir, "missing"), path.join(dir, "dangling"));
    await expect(readTemplateTree(dir)).rejects.toThrow(/dangling/);
  });

  it("rejects a nested symlink, naming its relative path", async () => {
    const dir = await makeTempDir();
    await put(dir, "a/real.txt");
    await fs.symlink(path.join(dir, "a/real.txt"), path.join(dir, "a/alias.txt"));
    await expect(readTemplateTree(dir)).rejects.toThrow(/a\/alias\.txt/);
  });

  it("rejects a hard-linked file", async () => {
    const dir = await makeTempDir();
    await put(dir, "one.txt");
    await fs.link(path.join(dir, "one.txt"), path.join(dir, "two.txt"));
    await expect(readTemplateTree(dir)).rejects.toThrow(/one\.txt|two\.txt/);
  });

  it.each(["latexmkrc", ".latexmkrc", "sub/LatexMkRC"])("rejects %s", async (name) => {
    const dir = await makeTempDir();
    await put(dir, "main.tex");
    await put(dir, name);
    await expect(readTemplateTree(dir)).rejects.toThrow(/latexmkrc/i);
  });

  it("rejects a .git folder", async () => {
    const dir = await makeTempDir();
    await put(dir, "main.tex");
    await put(dir, ".git/config");
    await expect(readTemplateTree(dir)).rejects.toThrow(/\.git/);
  });

  it("rejects a file over 5 MiB, naming it, and accepts one at the limit", async () => {
    const dir = await makeTempDir();
    await put(dir, "ok.bin", Buffer.alloc(5 * 1024 * 1024));
    expect(await readTemplateTree(dir)).toHaveLength(1);
    await put(dir, "big.bin", Buffer.alloc(5 * 1024 * 1024 + 1));
    await expect(readTemplateTree(dir)).rejects.toThrow(/big\.bin/);
  });

  it("rejects more than 500 files", async () => {
    const dir = await makeTempDir();
    await Promise.all(Array.from({ length: 501 }, (_, i) => put(dir, `f${i}.txt`, "")));
    await expect(readTemplateTree(dir)).rejects.toThrow();
  });
});
