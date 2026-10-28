import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import {
  detectLatexmk,
  createSystemTexProvider,
  listTexLiveBinDirs,
} from "../../../../../src/latex/node/systemTex";

let root: string;

async function fakeLatexmk(...parts: string[]): Promise<string> {
  const dir = join(root, ...parts);
  await mkdir(dir, { recursive: true });
  const file = join(dir, process.platform === "win32" ? "latexmk.exe" : "latexmk");
  await writeFile(file, "#!/bin/sh\n");
  await chmod(file, 0o755);
  return dir;
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "ls-tex-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("detectLatexmk", () => {
  it("prefers PATH over the known directories", async () => {
    const onPath = await fakeLatexmk("onpath");
    const known = await fakeLatexmk("known");
    const found = await detectLatexmk([known], { PATH: onPath });
    expect(found).toBe(join(onPath, process.platform === "win32" ? "latexmk.exe" : "latexmk"));
  });

  it("falls back to the known directories in order", async () => {
    const first = await fakeLatexmk("first");
    const second = await fakeLatexmk("second");
    const found = await detectLatexmk([join(root, "absent"), first, second], { PATH: "" });
    expect(found?.startsWith(first)).toBe(true);
  });

  it("returns undefined when nothing has latexmk", async () => {
    expect(await detectLatexmk([join(root, "absent")], { PATH: "" })).toBeUndefined();
  });
});

describe("listTexLiveBinDirs", () => {
  it("lists <year>/bin/<arch> with the highest year first and ignores other entries", async () => {
    await mkdir(join(root, "2024", "bin", "x86_64-linux"), { recursive: true });
    await mkdir(join(root, "2026", "bin", "universal-darwin"), { recursive: true });
    await mkdir(join(root, "2025", "bin", "x86_64-linux"), { recursive: true });
    await mkdir(join(root, "texmf-local"), { recursive: true });
    expect(await listTexLiveBinDirs(root)).toEqual([
      join(root, "2026", "bin", "universal-darwin"),
      join(root, "2025", "bin", "x86_64-linux"),
      join(root, "2024", "bin", "x86_64-linux"),
    ]);
  });

  it("is empty when the root does not exist", async () => {
    expect(await listTexLiveBinDirs(join(root, "absent"))).toEqual([]);
  });
});

describe("createSystemTexProvider", () => {
  it("resolves latexmk from PATH with the requested engine", async () => {
    const onPath = await fakeLatexmk("onpath");
    const provider = createSystemTexProvider({ env: { PATH: onPath } });
    const toolchain = await provider.resolve("xelatex");
    expect(toolchain).toEqual({ engine: "xelatex", executable: expect.stringContaining(onPath), binDir: onPath });
  });

  it("resolves from extraDirs when PATH has none", async () => {
    const extra = await fakeLatexmk("extra");
    const provider = createSystemTexProvider({ env: { PATH: ["", "nowhere"].join(delimiter) }, extraDirs: [extra] });
    const toolchain = await provider.resolve("pdflatex");
    expect(toolchain).not.toBe("missing");
  });

  it("never installs a missing file", async () => {
    expect(await createSystemTexProvider().installMissing("foo.sty")).toBe(false);
  });
});
