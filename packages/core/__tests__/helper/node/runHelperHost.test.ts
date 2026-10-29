// Pins the helper host: the version-rejection hook runs once and is awaited, and --install-python reports its outcome.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { runHelperHost, runInstallPython } from "../../../src/helper/node/runHelperHost.js";
import { PROTOCOL_VERSION } from "../../../src/helper/index.js";
import { encodeFrame } from "./helperConnectionHarness.js";

const logger = { log: async () => undefined, error: async () => undefined, redact: () => undefined } as never;

describe("runHelperHost", () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = await mkdtemp(join(tmpdir(), "labshelf-host-")); });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it("waits for afterVersionRejected after a hello of another protocol version", async () => {
    const input = new PassThrough();
    const events: string[] = [];
    const done = runHelperHost({
      dataDir, logger, helperVersion: "0.2.0", host: "helper", args: [], typstWasm: async () => new Uint8Array(), input,
      output: new PassThrough(),
      afterVersionRejected: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); events.push("update checked"); },
    }).then(() => events.push("host exited"));
    input.write(encodeFrame({ v: PROTOCOL_VERSION + 1, id: "1", type: "hello", extensionVersion: "9", origin: "chrome-extension://abc" }));
    input.end();
    await done;
    expect(events).toEqual(["update checked", "host exited"]);
  });
});

type Provider = Parameters<typeof runInstallPython>[0];
type Status = Awaited<ReturnType<Provider["install"]>>;

const INSTALLED = { state: "installed", version: "3.12.4", sympy: "1.13.0" } as Status;
const MISSING = { state: "missing" } as Status;

function fakeProvider(install: Provider["install"]): { provider: Provider; install: jest.Mock } {
  const fn = jest.fn(install);
  const provider = { status: async () => MISSING, install: fn } as unknown as Provider;
  return { provider, install: fn };
}

function collect(): { lines: string[]; write: (message: string) => void } {
  const lines: string[] = [];
  return { lines, write: (message) => void lines.push(message) };
}

describe("runInstallPython", () => {
  it("11.7a returns 0 after a successful install", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { write } = collect();
    expect(await runInstallPython(provider, write)).toBe(0);
  });

  it("11.7a calls install exactly once", async () => {
    const { provider, install } = fakeProvider(async () => INSTALLED);
    await runInstallPython(provider, collect().write);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("11.7a names the installed Python version on success", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.includes("3.12.4"))).toBe(true);
  });

  it("11.7a does not write a failure line on success", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.startsWith("Python install failed:"))).toBe(false);
  });

  it("11.7a passes progress messages from install to write", async () => {
    const { provider } = fakeProvider(async (onProgress) => {
      onProgress?.("Downloading Python", 0.25);
      return INSTALLED;
    });
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.includes("Downloading Python"))).toBe(true);
  });

  it("11.7a returns 1 and writes a failure line when install throws", async () => {
    const { provider } = fakeProvider(async () => {
      throw new Error("network down");
    });
    const { lines, write } = collect();
    expect(await runInstallPython(provider, write)).toBe(1);
    const failure = lines.filter((line) => line.startsWith("Python install failed:"));
    expect(failure).toHaveLength(1);
    expect(failure[0]).toContain("network down");
  });

  it("11.7a returns 1 and writes a failure line when install resolves missing", async () => {
    const { provider } = fakeProvider(async () => MISSING);
    const { lines, write } = collect();
    expect(await runInstallPython(provider, write)).toBe(1);
    expect(lines.filter((line) => line.startsWith("Python install failed:"))).toHaveLength(1);
  });

  it("11.7a does not throw when install throws a non-Error value", async () => {
    const { provider } = fakeProvider(async () => {
      throw "boom";
    });
    const { lines, write } = collect();
    await expect(runInstallPython(provider, write)).resolves.toBe(1);
    expect(lines.some((line) => line.startsWith("Python install failed:") && line.includes("boom"))).toBe(true);
  });

  it("11.7a calls install once even when it fails", async () => {
    const { provider, install } = fakeProvider(async () => {
      throw new Error("x");
    });
    await runInstallPython(provider, collect().write);
    expect(install).toHaveBeenCalledTimes(1);
  });
});
