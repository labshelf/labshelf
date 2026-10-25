// Pins the Typst `compile` path through core's compiler: the PDF as pages, failing problems, cancelling and the font download's progress.
import type { ToPageMessage } from "../../../../src/helper/index.js";

import { createBuildHarness, type BuildHarness } from "./harness";

jest.setTimeout(30_000);

let h: BuildHarness;

beforeEach(async () => { h = await createBuildHarness(); });
afterEach(async () => { await h.cleanup(); });

const compileTypst = (id: string): Promise<void> => h.compile(id, { main: "main.typ" });
const typeOf = (frames: ToPageMessage[]): string[] => frames.map((f) => f.type);

test("a .typ compile sends progress, built succeeded and then the pages", async () => {
  await h.typstSource("= Title\n#pagebreak()\nSecond page\n");
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(typeOf(frames)).toEqual(["progress", "built", "pages"]);
  expect(frames[1]).toMatchObject({ status: "succeeded", problems: [] });
  expect(frames[2]).toMatchObject({ pageCount: 2 });
  expect(h.payloadOf(frames[2]!)?.byteLength).toBeGreaterThan(0);
});

test("a failing .typ compile ends with built failed and the problem in main.typ", async () => {
  await h.typstSource("#undefined-variable\n");
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(frames.at(-1)).toMatchObject({ type: "built", status: "failed", problems: [expect.objectContaining({ severity: "error", file: "main.typ" })] });
});

test("a cancelled Typst build discards its result and reports cancelled", async () => {
  await h.typstSource("= Title\n");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const open = h.typst.get.getMockImplementation()!;
  h.typst.get.mockImplementationOnce(async (...args: unknown[]) => { await gate; return open(...args); });
  await compileTypst("t1");
  await h.cancel("c1");
  release();
  const frames = await h.finished("t1");

  expect(frames.at(-1)).toMatchObject({ type: "built", status: "cancelled" });
  expect(frames.some((f) => f.type === "pages")).toBe(false);
});

test("a font download while the compiler opens reports building progress to the build", async () => {
  await h.typstSource("= Title\n");
  const open = h.typst.get.getMockImplementation()!;
  h.typst.get.mockImplementationOnce((...args: unknown[]) => h.withFontDownload(() => open(...args)));
  await compileTypst("t1");
  const frames = await h.finished("t1");

  expect(frames.filter((f) => f.type === "progress")).toEqual([
    expect.objectContaining({ phase: "building", message: "Building main.typ" }),
    expect.objectContaining({ phase: "building", message: "Downloading Typst's default fonts (9 MB, once)" }),
  ]);
  expect(frames.at(-1)).toMatchObject({ type: "pages" });
});
