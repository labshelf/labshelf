// Pins how the build handlers answer build and cancel: the changed pages, the missing-file loop, shell escape, a missing TeX and cancelling.
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PDFDocument } from "pdf-lib";

import type { ToPageMessage } from "../../../../../src/writing/helper/index.js";

import { createBuildHarness, type BuildHarness } from "./harness";

jest.setTimeout(30_000);

let h: BuildHarness;

beforeEach(async () => { h = await createBuildHarness(); });
afterEach(async () => { await h.cleanup(); });

function built(frames: ToPageMessage[]): Extract<ToPageMessage, { type: "built" }> {
  const frame = frames.find((f) => f.type === "built");
  if (frame?.type !== "built") { throw new Error("no built frame"); }
  return frame;
}

async function runs(): Promise<string[][]> {
  const text = await readFile(join(h.buildDir, "main.tex", "runs.jsonl"), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as string[]);
}

async function waitForFile(file: string): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    if (await access(file).then(() => true, () => false)) { return; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${file} never appeared`);
}

type PagesMessage = Extract<ToPageMessage, { type: "pages" }>;

function pagesOf(frames: ToPageMessage[]): PagesMessage {
  const frame = frames.find((f) => f.type === "pages");
  if (frame?.type !== "pages") { throw new Error("no pages frame"); }
  return frame;
}

async function onePagePdfs(pages: PagesMessage): Promise<number[]> {
  const payload = h.payloadOf(pages)!;
  return Promise.all(pages.changed.map(async ({ offset, length }) => {
    const pdf = await PDFDocument.load(payload.subarray(offset, offset + length));
    return pdf.getPageCount();
  }));
}

test("the first compile sends progress, built with the PDF hash, then pages with every page", async () => {
  await h.project("ok", "one", "two", "three");
  await h.compile("b1");
  const frames = await h.finished("b1");

  expect(frames.map((f) => f.type)).toEqual(["progress", "built", "pages"]);
  expect(frames[0]).toMatchObject({ type: "progress", phase: "building" });
  const result = built(frames);
  expect(result.status).toBe("succeeded");
  const pages = pagesOf(frames);
  expect(pages).toMatchObject({ pdfSha256: result.pdfSha256, pageCount: 3 });
  expect(pages.changed.map((c) => c.index)).toEqual([0, 1, 2]);
  const payload = h.payloadOf(pages)!;
  expect(pages.changed[0]!.offset).toBe(0);
  expect(pages.changed[1]!.offset).toBe(pages.changed[0]!.length);
  expect(pages.changed.reduce((sum, c) => sum + c.length, 0)).toBe(payload.length);
  expect(await onePagePdfs(pages)).toEqual([1, 1, 1]);
});

test("a compile after editing one page sends only that page, and an unchanged one sends none", async () => {
  await h.project("ok", "one", "two", "three");
  await h.compile("b1");
  await h.finished("b1");

  await h.project("ok", "one", "TWO changed", "three");
  await h.compile("b2");
  const second = pagesOf(await h.finished("b2"));
  expect(second.pageCount).toBe(3);
  expect(second.changed.map((c) => c.index)).toEqual([1]);

  await h.compile("b3");
  const third = pagesOf(await h.finished("b3"));
  expect(third.changed).toEqual([]);
  expect(h.payloadOf(third)?.length ?? 0).toBe(0);

  await h.project("ok", "one", "TWO changed");
  await h.compile("b4");
  expect(pagesOf(await h.finished("b4"))).toMatchObject({ pageCount: 2, changed: [] });
});

test("forget makes the next compile send every page again", async () => {
  await h.project("ok", "one", "two");
  await h.compile("b1");
  await h.finished("b1");
  h.handlers.forget("thesis");
  await h.compile("b2");

  expect(pagesOf(await h.finished("b2")).changed.map((c) => c.index)).toEqual([0, 1]);
});

test("a project that is not open ends with a project-id error and no build", async () => {
  await h.compile("b1", { projectId: "other" });
  const frames = await h.finished("b1");

  expect(frames.at(-1)).toMatchObject({ type: "error", code: "project-id" });
  expect(frames.some((f) => f.type === "built" || f.type === "pages")).toBe(false);
});

test("the missing-file loop installs and rebuilds at most 10 rounds, then fails", async () => {
  await h.project("missing");
  await h.compile("b1");
  const frames = await h.finished("b1");

  const installs = frames.filter((f) => f.type === "progress" && f.phase === "installing-package");
  expect(installs).toHaveLength(10);
  expect(h.tex.installMissing).toHaveBeenCalledTimes(10);
  expect(h.tex.installMissing).toHaveBeenCalledWith("foo.sty");
  const allRuns = await runs();
  expect(allRuns).toHaveLength(11);
  // A rebuild after an install must be forced: latexmk skips a failed build whose sources did not change.
  expect(allRuns.map((args) => args.includes("-g"))).toEqual([false, ...Array(10).fill(true)]);
  const result = built(frames);
  expect(result.status).toBe("failed");
  expect(result.problems[0]).toMatchObject({ severity: "error", file: "main.tex" });
});

test("a missing file the provider cannot install fails after one build", async () => {
  h.tex.installMissing.mockResolvedValue(false);
  await h.project("missing");
  await h.compile("b1");
  const frames = await h.finished("b1");

  expect(built(frames).status).toBe("failed");
  expect(h.tex.installMissing).toHaveBeenCalledTimes(1);
  expect(await runs()).toHaveLength(1);
});

test("a document that needs shell escape ends needs-shell-escape and latexmk never gets the flag", async () => {
  await h.project("minted");
  await h.compile("b1");
  const result = built(await h.finished("b1"));

  expect(result.status).toBe("needs-shell-escape");
  expect(result.problems[0]).toMatchObject({ severity: "error", file: "main.tex", message: expect.stringContaining("minted") });
  const args = (await runs()).flat();
  expect(args.some((arg) => /shell.?escape|write18/i.test(arg))).toBe(false);
  expect(h.tex.installMissing).not.toHaveBeenCalled();
});

test("no TeX installation ends toolchain-missing without running latexmk", async () => {
  h.tex.resolve.mockResolvedValue("missing");
  await h.project("ok");
  await h.compile("b1");
  const result = built(await h.finished("b1"));

  expect(result).toMatchObject({ status: "toolchain-missing", problems: [] });
  await expect(access(join(h.buildDir, "main.tex", "runs.jsonl"))).rejects.toThrow();
});

test("cancel stops a running build, which ends cancelled", async () => {
  await h.project("hang");
  await h.compile("b1");
  await waitForFile(join(h.buildDir, "main.tex", "started"));
  await h.cancel("c1");

  expect(built(await h.finished("b1"))).toMatchObject({ status: "cancelled", problems: [] });
});

test("a newer build of the same project cancels the running one", async () => {
  await h.project("hang");
  await h.compile("b1");
  await waitForFile(join(h.buildDir, "main.tex", "started"));
  await h.project("ok");
  await h.compile("b2");

  expect(built(await h.finished("b1")).status).toBe("cancelled");
  expect(built(await h.finished("b2")).status).toBe("succeeded");
});
