/** Verifies the Tectonic install: checksum before extraction, version folders and cleanup after failure or abort. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { installedTectonic, installTectonic } from "../../../../../src/writing/latex/toolchain/node/index";
import { fakeLogger } from "../../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../../../support/tempDirs";

const archiveHash = { value: "" };

jest.mock("../../../../../src/writing/latex/toolchain/tectonicRelease", () => ({
  ...jest.requireActual("../../../../../src/writing/latex/toolchain/tectonicRelease"),
  tectonicAsset: () => ({
    url: "https://example.test/tectonic.tar.gz", sha256: archiveHash.value, sizeMb: 1, archive: "tar.gz",
    binary: process.platform === "win32" ? "tectonic.exe" : "tectonic",
  }),
}));

afterEach(cleanupTempDirs);

const posixOnly = process.platform === "win32" ? it.skip : it;

async function buildArchive(): Promise<Buffer> {
  const dir = await makeTempDir();
  const name = process.platform === "win32" ? "tectonic.exe" : "tectonic";
  await fs.writeFile(path.join(dir, name), "#!/bin/sh\necho tectonic 0.0.0\n", { mode: 0o644 });
  const archive = path.join(dir, "out.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", dir, name]);
  const bytes = await fs.readFile(archive);
  archiveHash.value = createHash("sha256").update(bytes).digest("hex");
  return bytes;
}

const serving = (bytes: Buffer) => jest.fn(async () => new Response(new Uint8Array(bytes)));

describe("installTectonic", () => {
  posixOnly("installs an executable binary that installedTectonic finds, and drops other versions", async () => {
    const storage = await makeTempDir();
    const stale = path.join(storage, "tectonic", "0.0.1");
    await fs.mkdir(stale, { recursive: true });
    await fs.writeFile(path.join(stale, "tectonic"), "old");
    const logger = fakeLogger();

    const binary = await installTectonic(storage, { logger, fetch: serving(await buildArchive()) });

    expect(binary).toBe(path.join(storage, "tectonic", "0.17.0", "tectonic"));
    expect(await installedTectonic(storage)).toBe(binary);
    expect((await fs.stat(binary)).mode & 0o111).not.toBe(0);
    expect(await listFiles(storage)).toEqual(["tectonic/0.17.0/tectonic"]);
    expect(logger.logs.map((entry) => entry.message)).toEqual(["Installing Tectonic", "Installed Tectonic"]);
  });

  it("rejects a checksum mismatch before extracting and leaves nothing behind", async () => {
    const storage = await makeTempDir();
    const bytes = await buildArchive();
    archiveHash.value = "0".repeat(64);
    const logger = fakeLogger();

    await expect(installTectonic(storage, { logger, fetch: serving(bytes) })).rejects.toThrow(
      /expected 0{64}, got [0-9a-f]{64}/,
    );
    expect(await listFiles(storage)).toEqual([]);
    expect(await installedTectonic(storage)).toBeUndefined();
    expect(logger.errors).toHaveLength(1);
  });

  it("reports an HTTP failure and leaves nothing behind", async () => {
    const storage = await makeTempDir();
    const fetch = jest.fn(async () => new Response("no", { status: 404 }));
    await expect(installTectonic(storage, { logger: fakeLogger(), fetch })).rejects.toThrow(/HTTP 404/);
    expect(await listFiles(storage)).toEqual([]);
  });

  it("leaves nothing behind when aborted", async () => {
    const storage = await makeTempDir();
    const controller = new AbortController();
    const fetch = jest.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      controller.abort(new Error("cancelled"));
    }));

    await expect(installTectonic(storage, { logger: fakeLogger(), signal: controller.signal, fetch })).rejects.toThrow("cancelled");
    expect(await listFiles(storage)).toEqual([]);
    expect(await pathExists(path.join(storage, "tectonic", "0.17.0"))).toBe(false);
  });
});
