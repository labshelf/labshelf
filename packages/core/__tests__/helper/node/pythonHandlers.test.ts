/** Verifies the installPython handler against a fake provider, and the hello ready's python field. */
import type { ILogger } from "../../../src/ports/index.js";
import { PROTOCOL_VERSION } from "../../../src/helper/index.js";
import type { TexToolchain, ToHelperMessage, ToPageMessage } from "../../../src/helper/index.js";
import { answerHello, type HelloMessage } from "../../../src/helper/node/helperHandlers.js";
import type { HelperLogger } from "../../../src/helper/node/helperPrivacy.js";
import { createPythonHandlers } from "../../../src/helper/node/runHelperHost.js";
import type { PythonProvider, PythonStatus } from "../../../src/qmd/compute/node/managedPython.js";

const TEX: TexToolchain = { source: "texlive", year: 2026, complete: true };
const INSTALLED: PythonStatus = { state: "installed", version: "3.12.7", sympy: "1.13.3" };

const errors: unknown[] = [];
const logger = { log: async () => undefined, error: async (_module: string, error: unknown) => { errors.push(error); } } as unknown as ILogger;

type Progress = [message: string, fraction?: number];

function fakeProvider(steps: Progress[], outcome: "installed" | Error = "installed"): PythonProvider {
  return {
    status: async () => (outcome === "installed" ? INSTALLED : { state: "missing" }),
    install: async (onProgress) => {
      for (const [message, fraction] of steps) {
        if (fraction === undefined) { onProgress?.(message); } else { onProgress?.(message, fraction); }
      }
      if (outcome instanceof Error) { throw outcome; }
      return INSTALLED;
    },
  };
}

function setup(python: PythonProvider) {
  const sent: Array<Record<string, unknown>> = [];
  const texCalls: number[] = [];
  const { installPython } = createPythonHandlers({
    python,
    texStatus: async () => { texCalls.push(1); return TEX; },
    helperVersion: "1.2.3",
    host: "helper",
    logger,
  });
  const send = (message: ToPageMessage) => { sent.push(message as unknown as Record<string, unknown>); };
  const install = (id: string) => installPython({ v: PROTOCOL_VERSION, id, type: "installPython" }, send);
  return { sent, texCalls, install, installPython, send };
}

beforeEach(() => { errors.length = 0; });

describe("createPythonHandlers installPython", () => {
  it("11.2b sends one python progress per provider callback with the request id", async () => {
    const { sent, install } = setup(fakeProvider([["download", 0.2], ["extract", 0.6], ["wheels", 1]]));
    await install("41");
    const progress = sent.filter((m) => m.type === "progress");
    expect(progress).toHaveLength(3);
    expect(progress.map((m) => m.fraction)).toEqual([0.2, 0.6, 1]);
    for (const message of progress) {
      expect(message).toMatchObject({ v: PROTOCOL_VERSION, id: "41", type: "progress", phase: "python", message: "Installing Python" });
    }
  });

  it("11.2b leaves fraction out of a progress whose callback gave none", async () => {
    const { sent, install } = setup(fakeProvider([["starting"]]));
    await install("42");
    const progress = sent.find((m) => m.type === "progress");
    expect(progress).toBeDefined();
    expect(progress).not.toHaveProperty("fraction");
  });

  it("11.2b ends with a ready carrying python installed and tex from texStatus", async () => {
    const { sent, install } = setup(fakeProvider([["download", 0.5]]));
    await install("43");
    expect(sent.map((m) => m.type)).toEqual(["progress", "ready"]);
    expect(sent[1]).toEqual({
      v: PROTOCOL_VERSION, id: "43", type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.2.3", host: "helper", tex: TEX, python: "installed",
    });
  });

  it("11.2b sends only the ready when the provider reports no progress", async () => {
    const { sent, install } = setup(fakeProvider([]));
    await install("44");
    expect(sent).toMatchObject([{ id: "44", type: "ready", python: "installed" }]);
  });

  it("11.2b answers a failing install with one python-install-failed error and no ready", async () => {
    const { sent, install } = setup(fakeProvider([["download", 0.1]], new Error("checksum mismatch")));
    await install("45");
    expect(sent.filter((m) => m.type === "ready")).toHaveLength(0);
    const failures = sent.filter((m) => m.type === "error");
    expect(failures).toEqual([{ v: PROTOCOL_VERSION, id: "45", type: "error", code: "python-install-failed", message: "checksum mismatch" }]);
  });

  it("11.2b logs the install failure through the logger's error", async () => {
    const boom = new Error("disk full");
    const { install } = setup(fakeProvider([], boom));
    await install("46");
    expect(errors).toContain(boom);
  });

  it("11.2b rejects a message of another type", async () => {
    const { installPython, send } = setup(fakeProvider([]));
    const other: ToHelperMessage = { v: PROTOCOL_VERSION, id: "47", type: "cancel", projectId: "p" };
    await expect(installPython(other, send)).rejects.toThrow();
  });
});

describe("answerHello python status", () => {
  const helloMessage: HelloMessage = { v: PROTOCOL_VERSION, id: "5", type: "hello", extensionVersion: "0.2.0", origin: "chrome-extension://abcdefghijklmnop" };
  const helloLogger = { log: async () => undefined, error: async () => undefined, redact: () => undefined } as unknown as HelperLogger;

  async function readyFor(pythonStatus?: () => Promise<PythonStatus>): Promise<Record<string, unknown> | undefined> {
    const sent: Array<Record<string, unknown>> = [];
    const socket = await answerHello(helloMessage, (m) => { sent.push(m as unknown as Record<string, unknown>); }, {
      helperVersion: "1.2.3", host: "helper", texStatus: async () => TEX, logger: helloLogger, handle: () => undefined,
      ...(pythonStatus ? { pythonStatus } : {}),
    });
    await socket?.close();
    return sent.find((m) => m.type === "ready");
  }

  it("11.2b sends a ready with python missing when pythonStatus says missing", async () => {
    const ready = await readyFor(async () => ({ state: "missing" }));
    expect(ready).toEqual({
      v: PROTOCOL_VERSION, id: "5", type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.2.3", host: "helper", tex: TEX, python: "missing",
    });
  });

  it("11.2b sends a ready with python installed when pythonStatus says installed", async () => {
    const ready = await readyFor(async () => INSTALLED);
    expect(ready).toMatchObject({ id: "5", type: "ready", python: "installed" });
  });

  it("11.2b sends a ready without python when no pythonStatus is given", async () => {
    const ready = await readyFor();
    expect(ready).toMatchObject({ id: "5", type: "ready", tex: TEX });
    expect(ready).not.toHaveProperty("python");
  });
});
