// Pins the helper's builds: the build handlers' answers to compile and cancel (LaTeX and Typst), the pages they compare and send and the TeX setup prompt.
import { promises as fs } from "node:fs";
import { access, readFile } from "node:fs/promises";
import * as path from "node:path";
import { join } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { MAX_SOCKET_MESSAGE_BYTES, PROTOCOL_VERSION, type ToPageMessage } from "../../../src/helper/index.js";
import { comparePages, createHelperToolchainAsk, sendPages, type SentPages } from "../../../src/helper/node/helperBuild";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";

import { createBuildHarness, type BuildHarness } from "./helperBuildHarness";

jest.setTimeout(30_000);

describe("build handlers", () => {
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

  test("removeMirroredPath makes the next compile send every page again", async () => {
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
    expect(args.some((arg) => /(?<!no-)shell.?escape|write18/i.test(arg))).toBe(false);
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

  describe("typst", () => {
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
  });
});

describe("sendPages", () => {
  afterEach(async () => { jest.restoreAllMocks(); await cleanupTempDirs(); });

  async function pdfFile(): Promise<string> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([200, 200]);
    const file = path.join(await makeTempDir(), "main.pdf");
    await fs.writeFile(file, await doc.save());
    return file;
  }

  it("keeps the previous hashes when a reply cannot be sent", async () => {
    const sent: SentPages = { hashes: [] };
    const send = jest.fn(() => { throw new Error("socket closed"); });
    await expect(sendPages("1", await pdfFile(), [], sent, send)).rejects.toThrow("socket closed");
    expect(sent.hashes).toEqual([]);
    expect(sent.pdfSha256).toBeUndefined();
  });

  it("records the hashes after both replies are sent", async () => {
    const sent: SentPages = { hashes: [] };
    const send = jest.fn();
    await sendPages("1", await pdfFile(), [], sent, send);
    expect(send.mock.calls.map(([message]) => (message as { type: string }).type)).toEqual(["built", "pages"]);
    expect(sent.hashes).toHaveLength(1);
  });

  it("refuses changed pages over the socket message limit with a limit error and sends nothing", async () => {
    const file = await pdfFile();
    jest.spyOn(PDFDocument.prototype, "save").mockResolvedValue(new Uint8Array(MAX_SOCKET_MESSAGE_BYTES));
    const sent: SentPages = { hashes: [] };
    const send = jest.fn();
    await expect(sendPages("1", file, [], sent, send)).rejects.toMatchObject({ code: "limit" });
    expect(send).not.toHaveBeenCalled();
    expect(sent.hashes).toEqual([]);
    expect(sent.pdfSha256).toBeUndefined();
  });

  it("reuses page hashes for identical PDF bytes without splitting the PDF again", async () => {
    const diff = jest.spyOn(PDFDocument, "load");
    const sent: SentPages = { hashes: [] };
    const send = jest.fn();
    const file = await pdfFile();
    await sendPages("1", file, [], sent, send);
    await sendPages("2", file, [], sent, send);
    expect(diff).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[3]?.[0]).toMatchObject({ type: "pages", pageCount: 1, changed: [] });
  });

  it("retries page delivery after the pages reply fails", async () => {
    const diff = jest.spyOn(PDFDocument, "load");
    const sent: SentPages = { hashes: [] };
    const file = await pdfFile();
    const send = jest.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("socket closed"); });
    await expect(sendPages("1", file, [], sent, send)).rejects.toThrow("socket closed");
    expect(sent.pdfSha256).toBeUndefined();
    await sendPages("2", file, [], sent, send);
    expect(diff).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[3]?.[0].changed).toHaveLength(1);
  });
});

describe("createHelperToolchainAsk", () => {
  it("never chooses a TeX install", async () => {
    expect(await createHelperToolchainAsk("b1", () => undefined).chooseInstall()).toBeUndefined();
  });

  it("sends installing-package progress for its build id and returns what the work returns", async () => {
    const sent: ToPageMessage[] = [];
    const result = await createHelperToolchainAsk("b1", (frame) => sent.push(frame))
      .progress("Installing the LaTeX package for foo.sty", async (report) => { report("50%"); return true; });
    expect(result).toBe(true);
    expect(sent).toEqual([
      { v: PROTOCOL_VERSION, id: "b1", type: "progress", phase: "installing-package", message: "Installing the LaTeX package for foo.sty" },
      { v: PROTOCOL_VERSION, id: "b1", type: "progress", phase: "installing-package", message: "Installing the LaTeX package for foo.sty: 50%" },
    ]);
  });
});

async function makePdf(texts: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) { doc.addPage([200, 200]).drawText(text, { x: 20, y: 100, size: 12, font }); }
  return doc.save();
}

describe("comparePages", () => {
  it("marks every page changed on the first call and returns one-page PDFs", async () => {
    const result = await comparePages([], await makePdf(["one", "two", "three"]));
    expect(result.pageCount).toBe(3);
    expect(result.hashes).toHaveLength(3);
    expect(result.changed.map((page) => page.index)).toEqual([0, 1, 2]);
    for (const page of result.changed) {
      expect(Buffer.from(page.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
      expect((await PDFDocument.load(page.bytes)).getPageCount()).toBe(1);
    }
  });

  it("returns only the page whose text changed", async () => {
    const first = await comparePages([], await makePdf(["one", "two", "three"]));
    const second = await comparePages(first.hashes, await makePdf(["one", "TWO", "three"]));
    expect(second.pageCount).toBe(3);
    expect(second.changed.map((page) => page.index)).toEqual([1]);
    expect(second.hashes[0]).toBe(first.hashes[0]);
    expect(second.hashes[1]).not.toBe(first.hashes[1]);
  });

  it("returns nothing when the PDF is the same", async () => {
    const pdf = await makePdf(["one", "two"]);
    const first = await comparePages([], pdf);
    expect((await comparePages(first.hashes, pdf)).changed).toEqual([]);
  });

  it("drops the page count when pages disappear and reports no changed page for the removed ones", async () => {
    const first = await comparePages([], await makePdf(["one", "two", "three"]));
    const second = await comparePages(first.hashes, await makePdf(["one", "two"]));
    expect(second.pageCount).toBe(2);
    expect(second.hashes).toHaveLength(2);
    expect(second.changed).toEqual([]);
  });

  it("reports added pages as changed", async () => {
    const first = await comparePages([], await makePdf(["one"]));
    const second = await comparePages(first.hashes, await makePdf(["one", "two"]));
    expect(second.pageCount).toBe(2);
    expect(second.changed.map((page) => page.index)).toEqual([1]);
  });
});
