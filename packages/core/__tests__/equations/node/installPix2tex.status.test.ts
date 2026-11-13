// Contract of the managed pix2tex status and the weight and pip checks of A8.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mockPin, makeFixture, onProgress, assertNothingInstalled, removeTmpDirs } from "./installPix2texHarness.js";

afterEach(removeTmpDirs);

// ---- 4.1a: the status -------------------------------------------------------------------------

describe("managed pix2tex status", () => {
  it("4.1a is missing before any install and creates nothing", async () => {
    const fx = await makeFixture();
    expect(await fx.provider.status()).toBe("missing");
    expect(existsSync(fx.root)).toBe(false);
  });

  it("4.1a is installed only when the marker holds the pinned version", async () => {
    const fx = await makeFixture();
    await mkdir(fx.root, { recursive: true });
    await writeFile(join(fx.root, "pix2tex-pin.json"), JSON.stringify({ version: "9.9.9" }));
    expect(await fx.provider.status()).toBe("installed");
    await writeFile(join(fx.root, "pix2tex-pin.json"), JSON.stringify({ version: "9.9.8" }));
    expect(await fx.provider.status()).toBe("missing");
  });

  it("4.1a is missing when the marker is not JSON", async () => {
    const fx = await makeFixture();
    await mkdir(fx.root, { recursive: true });
    await writeFile(join(fx.root, "pix2tex-pin.json"), "{not json");
    expect(await fx.provider.status()).toBe("missing");
  });

  it("4.1a is missing when a venv and weights exist without the marker", async () => {
    const fx = await makeFixture();
    await mkdir(join(fx.root, "venv", "bin"), { recursive: true });
    await mkdir(join(fx.root, "weights"), { recursive: true });
    expect(await fx.provider.status()).toBe("missing");
  });

  it("4.1a is unsupported on a platform and architecture with no pin key", async () => {
    const fx = await makeFixture("freebsd", "x64");
    expect(await fx.provider.status()).toBe("unsupported");
  });

  it("4.1a is unsupported when the pin entry of the platform is null", async () => {
    expect(await (await makeFixture("darwin", "x64")).provider.status()).toBe("unsupported");
    expect(await (await makeFixture("linux", "arm64")).provider.status()).toBe("unsupported");
  });

  it("4.1a is supported on a platform whose pin entry exists", async () => {
    expect(await (await makeFixture("darwin", "arm64")).provider.status()).toBe("missing");
  });
});

// ---- A8 ---------------------------------------------------------------------------------------

describe("managed pix2tex A8", () => {
  it("A8 verifies every weight through the download with the pinned sha256 and installs nothing when one fails", async () => {
    const fx = await makeFixture();
    fx.failDownload.url = mockPin.weights[0]?.url ?? null;
    await expect(fx.provider.install(onProgress(fx))).rejects.toBeDefined();
    expect(fx.downloads[0]).toEqual({ url: mockPin.weights[0]?.url, sha256: mockPin.weights[0]?.sha256 });
    await assertNothingInstalled(fx);
  });

  it("A8 runs pip with --require-hashes and under the lock", async () => {
    const fx = await makeFixture();
    await fx.provider.install(onProgress(fx));
    expect(fx.runs[1]?.args).toContain("--require-hashes");
    expect(fx.calls.find((call) => call.kind === "pip")?.lock).toBe(true);
  });
});
