// Pins the Typst `compile` path: progress, install failure, the exported PDF as pages, failing diagnostics and cancelling.
import type { ToPageMessage } from "../../../../../src/writing/helper/index.js";

import { createBuildHarness, type BuildHarness } from "./harness";

jest.setTimeout(30_000);

let h: BuildHarness;

beforeEach(async () => { h = await createBuildHarness(); });
afterEach(async () => { await h.cleanup(); });

const compileTypst = (id: string): Promise<void> => h.compile(id, { main: "main.typ" });
const typeOf = (frames: ToPageMessage[]): string[] => frames.map((f) => f.type);

test("a successful export sends progress, built succeeded and the pages", async () => {
  await h.typst("ok");
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(typeOf(frames)).toEqual(["progress", "built", "pages"]);
  expect(frames[0]).toMatchObject({ phase: "building" });
  expect(frames[1]).toMatchObject({ status: "succeeded", problems: [] });
  expect(frames[2]).toMatchObject({ pageCount: 1, changed: [{ index: 0 }] });
  expect(h.payloadOf(frames[2]!)?.byteLength).toBeGreaterThan(0);
  expect(h.servers.start).toHaveBeenCalledWith("thesis", "t1", expect.any(Function));
});

test("warnings of a successful export ride on the built message", async () => {
  await h.typst("warn");
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(frames.find((f) => f.type === "built")).toMatchObject({
    status: "succeeded", problems: [{ severity: "warning", message: "unused import", file: "main.typ", line: 1 }],
  });
});

test("a failing export ends with built failed and the parsed problem", async () => {
  await h.typst("fail");
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(frames.at(-1)).toMatchObject({
    type: "built", status: "failed", problems: [{ severity: "error", message: "unknown variable: x", file: "main.typ", line: 3 }],
  });
});

test("a Tinymist that cannot be installed ends toolchain-missing and is logged", async () => {
  await h.typst("ok");
  h.tinymist.resolve.mockResolvedValue(undefined);
  h.tinymist.ensure.mockRejectedValue(new Error("offline"));
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(frames.at(-1)).toMatchObject({ type: "built", status: "toolchain-missing", problems: [{ severity: "error", file: "main.typ" }] });
  expect(h.logger.error).toHaveBeenCalled();
});

test("an install reports installing-tinymist progress before the build", async () => {
  await h.typst("ok");
  const binary = await h.tinymist.resolve();
  h.tinymist.resolve.mockResolvedValueOnce(undefined);
  h.tinymist.ensure.mockImplementation(async (onProgress: (p: { message: string; fraction?: number }) => void) => {
    onProgress({ message: "Downloading", fraction: 0.5 });
    return binary;
  });
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(frames.filter((f) => f.type === "progress").map((f) => f.type === "progress" && f.phase)).toEqual(["building", "installing-tinymist", "installing-tinymist"]);
  expect(frames.find((f) => f.type === "progress" && f.fraction === 0.5)).toMatchObject({ message: "Downloading" });
  expect(frames.at(-1)).toMatchObject({ type: "pages" });
});

test("a language server that fails to start does not fail the build", async () => {
  await h.typst("ok");
  h.servers.start.mockRejectedValue(new Error("spawn failed"));
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(frames.some((f) => f.type === "pages")).toBe(true);
  expect(h.logger.error).toHaveBeenCalled();
});

test("a newer build queues behind the one before it, and both end", async () => {
  await h.typst("ok");
  await compileTypst("t1");
  await compileTypst("t2");
  const first = await h.finished("t1");
  const second = await h.finished("t2");

  expect(first.at(-1)).toMatchObject({ type: expect.stringMatching(/built|pages/) });
  expect(second.some((f) => f.type === "pages")).toBe(true);
});
