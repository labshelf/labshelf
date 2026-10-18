// Tests installing, verifying and resolving the pinned Tinymist in the shared tools folder.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ILogger } from "../../../../../src/ports/index";

const BINARY = Buffer.from("#!/bin/sh\necho tinymist 9.9.9\n");
const URL = "https://example.org/tinymist-test";

jest.mock("../../../../../src/writing/typst/toolchain/tinymistPin", () => ({
  TINYMIST_VERSION: "9.9.9",
  tinymistAsset: (platform: string, arch: string) => platform === "linux" && arch === "x64"
    ? { version: "9.9.9", url: URL, sha256: createHash("sha256").update(BINARY).digest("hex"), binaryName: "tinymist" }
    : undefined,
}));

import { createManagedTinymist, TinymistInstallError } from "../../../../../src/writing/typst/toolchain/node/index";

let dir: string;
let root: string;
let emptyPath: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "labshelf-tinymist-")));
  root = join(dir, "LabShelf");
  emptyPath = join(dir, "empty-bin");
  await mkdir(emptyPath);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const logger = (): ILogger => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });

function fakeFetch(body: Buffer = BINARY, delayMs = 0): jest.Mock & typeof fetch {
  return jest.fn(async (url: string) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return url === URL ? new Response(new Uint8Array(body)) : new Response("missing", { status: 404 });
  }) as unknown as jest.Mock & typeof fetch;
}

const create = (fetchImpl: typeof fetch, platform: NodeJS.Platform = "linux", env: NodeJS.ProcessEnv = { PATH: emptyPath }) =>
  createManagedTinymist({ logger: logger(), fetchImpl, platform, arch: "x64", root, env });

describe("createManagedTinymist", () => {
  it("installs the verified binary as an executable and resolves it", async () => {
    const tinymist = create(fakeFetch());
    expect(await tinymist.resolve()).toBeUndefined();
    const binary = await tinymist.ensure();
    expect(binary).toBe(join(root, "tinymist", "9.9.9", "tinymist"));
    expect((await stat(binary)).mode & 0o777).toBe(0o755);
    expect(await tinymist.resolve()).toBe(binary);
  });

  it("rejects a binary whose hash differs, installs nothing and removes the staging folder", async () => {
    const tinymist = create(fakeFetch(Buffer.from("tampered")));
    await expect(tinymist.ensure()).rejects.toThrow(TinymistInstallError);
    await expect(tinymist.ensure()).rejects.toThrow(/9\.9\.9[\s\S]*Checksum mismatch/);
    expect(await readdir(join(root, "tinymist"))).toEqual([]);
  });

  it("downloads once when two instances ensure at the same time", async () => {
    const fetchImpl = fakeFetch(BINARY, 50);
    const [a, b] = await Promise.all([create(fetchImpl).ensure(), create(fetchImpl).ensure()]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("removes older version folders after the move", async () => {
    await mkdir(join(root, "tinymist", "0.1.0"), { recursive: true });
    await writeFile(join(root, "tinymist", "0.1.0", "tinymist"), "old", { mode: 0o755 });
    await create(fakeFetch()).ensure();
    expect(await readdir(join(root, "tinymist"))).toEqual(["9.9.9"]);
  });

  it("falls back to tinymist on PATH and reports none when PATH has none", async () => {
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "tinymist"), "#!/bin/sh\n", { mode: 0o755 });
    expect(await create(fakeFetch(), "linux", { PATH: bin }).resolve()).toBe(join(bin, "tinymist"));
    expect(await create(fakeFetch()).resolve()).toBeUndefined();
  });

  it("on an OS without a pinned asset resolves PATH only and ensure fails clearly", async () => {
    const fetchImpl = fakeFetch();
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "tinymist"), "#!/bin/sh\n", { mode: 0o755 });
    expect(await create(fetchImpl, "freebsd", { PATH: bin }).resolve()).toBe(join(bin, "tinymist"));
    await expect(create(fetchImpl, "freebsd").ensure()).rejects.toThrow(/freebsd-x64/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(join(root, "tinymist"))).toBe(false);
  });
});
