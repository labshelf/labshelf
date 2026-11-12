// Pins the browser's linked-output source port over a fake helper and a fake extension storage: the per-device mapping, the
// confirmation of a command once per device, the typed command counting as confirmed, the typed-path fallback and the missing-helper sentence.
import type { HelperState, ILatexHelper } from "@labshelf/core/helper";
import { createBrowserOutputSources, createLibraryOutputFiles, NEEDS_HELPER, OUTPUT_SOURCES_KEY, type OutputSourceArea } from "../../src/writing/outputSources";

const READY: HelperState = { state: "ready", helperVersion: "1", host: "helper", tex: { source: "none", complete: false }, capabilities: ["linkedOutputs"] };
const OLD: HelperState = { state: "ready", helperVersion: "1", host: "helper", tex: { source: "none", complete: false }, capabilities: ["ocr"] };
const logger = { log: async () => undefined, error: async () => undefined };

function fakeArea(initial: Record<string, unknown> = {}): OutputSourceArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = structuredClone(initial);
  return { data, get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}), set: async (items) => { Object.assign(data, structuredClone(items)); } };
}

function fakeHelper(state: HelperState, pick: { folder?: string; unavailable?: boolean } = { folder: "/home/ana/exp" }) {
  const runs: Array<{ folder: string; command: string }> = [];
  const helper = {
    status: () => state,
    connect: async () => state,
    sourcePick: jest.fn(async () => pick),
    sourceInspect: jest.fn(async (folder: string) => ({ exists: folder === "/typed/exp", remote: "https://github.com/ana/exp.git" })),
    sourceList: jest.fn(async () => ["results/fig.png"]),
    sourceRead: jest.fn(async () => Uint8Array.of(1, 2)),
    sourceRun: jest.fn(async (request: { folder: string; command: string }) => { runs.push({ folder: request.folder, command: request.command }); return { status: "finished" as const, code: 0, output: "ok" }; }),
  };
  return { helper: helper as unknown as ILatexHelper, raw: helper, runs };
}

const serial = <T>(run: () => Promise<T>): Promise<T> => run();
const signal = () => new AbortController().signal;

describe("browser output sources", () => {
  it("stores the picked folder per project and source, keeps other entries, and answers status without the helper", async () => {
    const area = fakeArea({ [OUTPUT_SOURCES_KEY]: { other: "kept as is" } });
    const { helper } = fakeHelper(READY);
    const port = createBrowserOutputSources({ area, projectId: "paper-a", helper: () => helper, logger, exclusive: serial });
    expect(await port.pick("experiments")).toBe("/home/ana/exp");
    expect(area.data[OUTPUT_SOURCES_KEY]).toEqual({ other: "kept as is", "paper-a\u0000experiments": { folder: "/home/ana/exp", confirmed: [] } });
    const offline = createBrowserOutputSources({ area, projectId: "paper-a", helper: () => fakeHelper(OLD).helper, logger, exclusive: serial });
    expect(await offline.status("experiments")).toEqual({ folder: "/home/ana/exp" });
    expect(await offline.status("other")).toBeUndefined();
    await expect(offline.list("experiments")).rejects.toThrow(NEEDS_HELPER);
    await port.unlink("experiments");
    expect(area.data[OUTPUT_SOURCES_KEY]).toEqual({ other: "kept as is" });
  });

  it("asks once per device for a shared command, and returns declined when refused", async () => {
    const area = fakeArea({ [OUTPUT_SOURCES_KEY]: { "p\u0000exp": { folder: "/home/ana/exp", confirmed: [] } } });
    const { helper, runs } = fakeHelper(READY);
    const confirmRun = jest.fn(async () => false);
    const port = createBrowserOutputSources({ area, projectId: "p", helper: () => helper, logger, exclusive: serial, confirmRun });
    expect(await port.run("exp", "python run.py", signal())).toEqual({ status: "declined" });
    expect(confirmRun).toHaveBeenCalledWith("python run.py", "/home/ana/exp");
    expect(runs).toEqual([]);
    confirmRun.mockResolvedValue(true);
    expect(await port.run("exp", "python run.py", signal())).toEqual({ status: "finished", code: 0, output: "ok" });
    expect(await port.run("exp", "python run.py", signal())).toMatchObject({ status: "finished" });
    expect(confirmRun).toHaveBeenCalledTimes(2);
    expect(runs).toEqual([{ folder: "/home/ana/exp", command: "python run.py" }, { folder: "/home/ana/exp", command: "python run.py" }]);
    // A different text needs its own confirmation.
    confirmRun.mockResolvedValue(false);
    expect(await port.run("exp", "python run.py --all", signal())).toEqual({ status: "declined" });
  });

  it("counts a command typed on this device as confirmed", async () => {
    const area = fakeArea({ [OUTPUT_SOURCES_KEY]: { "p\u0000exp": { folder: "/home/ana/exp", confirmed: [] } } });
    const { helper, runs } = fakeHelper(READY);
    const confirmRun = jest.fn(async () => false);
    const port = createBrowserOutputSources({ area, projectId: "p", helper: () => helper, logger, exclusive: serial, confirmRun });
    await port.setCommand("exp", "make all");
    expect(await port.status("exp")).toEqual({ folder: "/home/ana/exp", command: "make all" });
    expect(await port.run("exp", "make all", signal())).toMatchObject({ status: "finished" });
    expect(confirmRun).not.toHaveBeenCalled();
    expect(runs).toHaveLength(1);
    await port.setCommand("exp", undefined);
    expect(await port.status("exp")).toEqual({ folder: "/home/ana/exp" });
  });

  it("drops confirmations when the source moves to another folder", async () => {
    const area = fakeArea({ [OUTPUT_SOURCES_KEY]: { "p\u0000exp": { folder: "/old", confirmed: ["make"] } } });
    const port = createBrowserOutputSources({ area, projectId: "p", helper: () => fakeHelper(READY).helper, logger, exclusive: serial });
    await port.pick("exp");
    expect(area.data[OUTPUT_SOURCES_KEY]).toEqual({ "p\u0000exp": { folder: "/home/ana/exp", confirmed: [] } });
  });

  it("falls back to a typed path when the helper has no folder dialog, and checks it exists", async () => {
    const area = fakeArea();
    const { helper } = fakeHelper(READY, { unavailable: true });
    const typed = createBrowserOutputSources({ area, projectId: "p", helper: () => helper, logger, exclusive: serial, promptFolder: async () => " /typed/exp " });
    expect(await typed.pick("exp")).toBe("/typed/exp");
    const wrong = createBrowserOutputSources({ area, projectId: "p", helper: () => helper, logger, exclusive: serial, promptFolder: async () => "/not/there" });
    await expect(wrong.pick("exp")).rejects.toThrow("/not/there");
    const cancelled = createBrowserOutputSources({ area, projectId: "p", helper: () => helper, logger, exclusive: serial, promptFolder: async () => undefined });
    expect(await cancelled.pick("other")).toBeUndefined();
  });

  it("reads, lists and asks the remote through the helper with the stored folder", async () => {
    const area = fakeArea({ [OUTPUT_SOURCES_KEY]: { "p\u0000exp": { folder: "/home/ana/exp", confirmed: [] } } });
    const { helper, raw } = fakeHelper(READY);
    const port = createBrowserOutputSources({ area, projectId: "p", helper: () => helper, logger, exclusive: serial });
    expect(await port.list("exp")).toEqual(["results/fig.png"]);
    expect(await port.read("exp", "results/fig.png")).toEqual(Uint8Array.of(1, 2));
    expect(raw.sourceRead).toHaveBeenCalledWith("/home/ana/exp", "results/fig.png");
    expect(await port.remote("exp")).toBe("https://github.com/ana/exp.git");
    await expect(port.list("unknown")).rejects.toThrow("not linked");
  });
});

describe("library output files", () => {
  it("reads under the project folder and creates parents before writing", async () => {
    const files = new Map<string, Uint8Array>();
    const dirs: string[] = [];
    const fs = {
      stat: async (p: string) => (files.has(p) ? { isDirectory: false, mtimeMs: 0, size: 0 } : undefined),
      readFile: async (p: string) => files.get(p)!,
      writeFile: async (p: string, bytes: Uint8Array) => { files.set(p, bytes); },
      ensureDir: async (p: string) => { dirs.push(p); },
    };
    const port = createLibraryOutputFiles(fs, "projects/paper");
    expect(await port.readBytes("outputs/exp/fig.png")).toBeUndefined();
    await port.writeBytes("outputs/exp/fig.png", Uint8Array.of(7));
    expect(dirs).toEqual(["projects/paper/outputs/exp"]);
    expect(await port.readBytes("outputs/exp/fig.png")).toEqual(Uint8Array.of(7));
  });
});
