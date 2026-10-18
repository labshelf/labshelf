// Tests the installTex and installAllPackages handlers: progress frames, then ready or an error code.
import type { ILogger } from "../../../../../src/ports/index.js";
import type { ToHelperMessage, ToPageMessage } from "../../../../../src/writing/helper/index.js";

import { createTexInstallHandlers } from "../../../../../src/writing/helper/node/tex/index.js";
import { TexInstallError, type ManagedTexProvider } from "../../../../../src/writing/latex/toolchain/node/managed/index.js";

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const status = { source: "tinytex" as const, year: 2026, complete: true };

function fakeTex(overrides: Partial<ManagedTexProvider>): ManagedTexProvider {
  return {
    resolve: jest.fn(), installMissing: jest.fn(), status: jest.fn(async () => status),
    install: jest.fn(async (_kind, onProgress) => { onProgress(0.5); onProgress(null); return status; }),
    installAllPackages: jest.fn(async (onProgress) => { onProgress(0.25); return status; }),
    ...overrides,
  };
}

async function handle(tex: ManagedTexProvider, message: ToHelperMessage): Promise<ToPageMessage[]> {
  const sent: ToPageMessage[] = [];
  const handlers = createTexInstallHandlers({ tex, helperVersion: "0.1.0", host: "helper", logger });
  const handler = message.type === "installTex" ? handlers.installTex : handlers.installAllPackages;
  await handler(message, (frame) => sent.push(frame));
  return sent;
}

const installTex: ToHelperMessage = { v: 1, id: "3", type: "installTex", kind: "tinytex" };
const installAll: ToHelperMessage = { v: 1, id: "4", type: "installAllPackages" };

it("streams installing-tex progress, then ready with the status", async () => {
  const sent = await handle(fakeTex({}), installTex);
  expect(sent.map((frame) => frame.type)).toEqual(["progress", "progress", "ready"]);
  expect(sent[0]).toMatchObject({ id: "3", phase: "installing-tex", fraction: 0.5 });
  expect(sent[1]).not.toHaveProperty("fraction");
  expect(sent[2]).toEqual({ v: 1, id: "3", type: "ready", protocol: 1, helperVersion: "0.1.0", host: "helper", tex: status });
});

it("streams installing-package progress, then ready", async () => {
  const sent = await handle(fakeTex({}), installAll);
  expect(sent[0]).toMatchObject({ id: "4", type: "progress", phase: "installing-package", fraction: 0.25 });
  expect(sent.at(-1)).toMatchObject({ id: "4", type: "ready", tex: status });
});

it.each(["texlive-rollover", "no-managed-tex"] as const)("replies error %s", async (code) => {
  const sent = await handle(fakeTex({ installAllPackages: jest.fn(async () => { throw new TexInstallError(code, "stop"); }) }), installAll);
  expect(sent.at(-1)).toEqual({ v: 1, id: "4", type: "error", code, message: "stop" });
});

it("replies tex-install-failed with the cause for any other failure", async () => {
  const sent = await handle(fakeTex({ install: jest.fn(async () => { throw new Error("download failed: 404"); }) }), installTex);
  expect(sent.at(-1)).toMatchObject({ id: "3", type: "error", code: "tex-install-failed", message: expect.stringContaining("download failed: 404") });
});
