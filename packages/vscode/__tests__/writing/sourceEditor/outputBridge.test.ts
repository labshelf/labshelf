// Tests the LabShelf editor's linked-output requests: bytes cross as base64, null for absent, a run the page cancels is aborted, and no outputs reject except the outputs file read.
import { bytesToBase64 } from "@labshelf/core";
import type { OutputSourcePort } from "@labshelf/core";

import { createSourceBridges } from "../../../src/writing/sourceEditor/bridges";
import * as vscode from "vscode";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };

function build(outputs?: Parameters<typeof createSourceBridges>[0]["outputs"]) {
  return createSourceBridges({
    uri: vscode.Uri.file("/proj/main.tex"), projectRoot: vscode.Uri.file("/proj"),
    library: {} as never, notes: {} as never, openNotes: jest.fn(), logger: logger as never, outputs,
  });
}

function sources(overrides: Partial<OutputSourcePort> = {}): OutputSourcePort {
  return {
    status: jest.fn(async () => ({ folder: "/code" })), pick: jest.fn(async () => undefined), unlink: jest.fn(async () => {}), setCommand: jest.fn(async () => {}),
    list: jest.fn(async () => ["r/a.csv"]), read: jest.fn(async () => new Uint8Array([1, 2])), remote: jest.fn(async () => undefined),
    run: jest.fn(async () => ({ status: "finished" as const, code: 0, output: "" })), ...overrides,
  };
}

describe("source bridges: linked outputs", () => {
  it("reads project bytes as base64 and answers null for an absent file", async () => {
    const files = { readBytes: jest.fn(async (path: string) => (path === "a.png" ? new Uint8Array([7]) : undefined)), writeBytes: jest.fn(async () => {}) };
    const bridges = build({ files, sources: sources() });
    await expect(bridges.handle("readProjectBytes", { path: "a.png" })).resolves.toBe(bytesToBase64(new Uint8Array([7])));
    await expect(bridges.handle("readProjectBytes", { path: "b.png" })).resolves.toBeNull();
  });

  it("writes the decoded bytes", async () => {
    const files = { readBytes: jest.fn(async () => undefined), writeBytes: jest.fn(async () => {}) };
    await build({ files, sources: sources() }).handle("writeProjectBytes", { path: "outputs/s/a.bin", base64: bytesToBase64(new Uint8Array([3, 4])) });
    expect(files.writeBytes).toHaveBeenCalledWith("outputs/s/a.bin", new Uint8Array([3, 4]));
  });

  it("relays the source port: status null when not linked here, read as base64, setCommand without a command", async () => {
    const port = sources({ status: jest.fn(async () => undefined) });
    const bridges = build({ files: { readBytes: async () => undefined, writeBytes: async () => {} }, sources: port });
    await expect(bridges.handle("outputSourceStatus", { source: "s" })).resolves.toBeNull();
    await expect(bridges.handle("outputSourceRead", { source: "s", path: "r/a.csv" })).resolves.toBe(bytesToBase64(new Uint8Array([1, 2])));
    await expect(bridges.handle("outputSourceList", { source: "s" })).resolves.toEqual(["r/a.csv"]);
    await bridges.handle("outputSourceSetCommand", { source: "s" });
    expect(port.setCommand).toHaveBeenCalledWith("s", undefined);
  });

  it("aborts a run when the page cancels it", async () => {
    let signal: AbortSignal | undefined;
    const port = sources({ run: jest.fn((_source: string, _command: string, given: AbortSignal) => {
      signal = given;
      return new Promise((resolve) => given.addEventListener("abort", () => resolve({ status: "cancelled" as const })));
    }) });
    const bridges = build({ files: { readBytes: async () => undefined, writeBytes: async () => {} }, sources: port });
    const running = bridges.handle("outputSourceRun", { source: "s", command: "make" });
    await bridges.handle("outputSourceCancel", { source: "s" });
    await expect(running).resolves.toEqual({ status: "cancelled" });
    expect(signal?.aborted).toBe(true);
  });

  it("without outputs reads no outputs file and rejects the source requests", async () => {
    const bridges = build(undefined);
    await expect(bridges.handle("readProjectBytes", { path: ".labshelf/outputs.json" })).resolves.toBeNull();
    await expect(bridges.handle("outputSourceStatus", { source: "s" })).rejects.toThrow("desktop app");
  });
});
