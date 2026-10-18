// Pins how the build handlers answer build and cancel: the PDF stream, the missing-file loop, shell escape, a missing TeX and cancelling.
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

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

test("a successful build sends progress, built with the PDF hash, then chunks that reassemble to it", async () => {
  await h.project("ok");
  await h.send("build", "b1");
  const frames = await h.finished("b1");

  expect(frames[0]).toMatchObject({ type: "progress", phase: "building" });
  const result = built(frames);
  expect(result.status).toBe("succeeded");
  const chunks = frames.flatMap((f) => (f.type === "pdf" ? [f.chunk] : []));
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c.data, "base64")));
  expect(bytes.length).toBe(1300 * 1024);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(result.pdfSha256);
  expect(frames.indexOf(result)).toBeLessThan(frames.findIndex((f) => f.type === "pdf"));
});

test("the missing-file loop installs and rebuilds at most 10 rounds, then fails", async () => {
  await h.project("missing");
  await h.send("build", "b1");
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
  await h.send("build", "b1");
  const frames = await h.finished("b1");

  expect(built(frames).status).toBe("failed");
  expect(h.tex.installMissing).toHaveBeenCalledTimes(1);
  expect(await runs()).toHaveLength(1);
});

test("a document that needs shell escape ends needs-shell-escape and latexmk never gets the flag", async () => {
  await h.project("minted");
  await h.send("build", "b1");
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
  await h.send("build", "b1");
  const result = built(await h.finished("b1"));

  expect(result).toMatchObject({ status: "toolchain-missing", problems: [] });
  await expect(access(join(h.buildDir, "main.tex", "runs.jsonl"))).rejects.toThrow();
});

test("cancel stops a running build, which ends cancelled", async () => {
  await h.project("hang");
  await h.send("build", "b1");
  await waitForFile(join(h.buildDir, "main.tex", "started"));
  await h.send("cancel", "c1");

  expect(built(await h.finished("b1"))).toMatchObject({ status: "cancelled", problems: [] });
});

test("a newer build of the same project cancels the running one", async () => {
  await h.project("hang");
  await h.send("build", "b1");
  await waitForFile(join(h.buildDir, "main.tex", "started"));
  await h.project("ok");
  await h.send("build", "b2");

  expect(built(await h.finished("b1")).status).toBe("cancelled");
  expect(built(await h.finished("b2")).status).toBe("succeeded");
});
