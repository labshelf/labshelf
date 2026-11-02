// Hidden tests of spec 4.1: printDeckPdf over an injected Chromium run, and exportDeckPdf with its PDF result or print fallback.
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { exportDeckPdf, printDeckPdf } from "../../../src/decks/node/printPdf.js";
import type { CancellableOptions, RunOutcome } from "../../../src/latex/node/index.js";
import type { ILogger } from "../../../src/ports/index.js";

const HTML = "<!doctype html><html><head><style>@page { size: 1280px 720px; margin: 0 }</style></head><body><section>Hello</section></body></html>";
const PDF = Buffer.from("%PDF-1.7\nfake deck pdf bytes\n%%EOF\n");
const NOT_FOUND = "No Chromium was found, so the deck opened for printing. Install Chrome or Chromium to save the PDF automatically.";
const PRINT_FAILED_START = "Chromium could not print the deck, so the deck opened for printing.";
const SECOND_SENTENCE = "Install Chrome or Chromium to save the PDF automatically.";

interface RunCall { executable: string; args: string[]; cwd: string; options: CancellableOptions | undefined; htmlAtRun: string | undefined }

/** A fake runCancellable: records each call, writes `pdf` at the --print-to-pdf= path when given, and returns `outcome`. */
function fakeRun(outcome: RunOutcome, pdf: Buffer | null = PDF) {
  const calls: RunCall[] = [];
  const run = async (executable: string, args: string[], cwd: string, _signal: AbortSignal, options?: CancellableOptions): Promise<RunOutcome> => {
    const htmlPath = path.join(cwd, "deck.html");
    calls.push({ executable, args, cwd, options, htmlAtRun: existsSync(htmlPath) ? await fs.readFile(htmlPath, "utf8") : undefined });
    const target = args.find((arg) => arg.startsWith("--print-to-pdf="));
    if (pdf && target) { await fs.writeFile(target.slice("--print-to-pdf=".length), pdf); }
    return outcome;
  };
  return { run, calls };
}

/** The first recorded run call; fails the test when run was never called. */
function firstCall(calls: RunCall[]): RunCall {
  const call = calls[0];
  if (!call) { throw new Error("run was not called"); }
  return call;
}

function makeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
}

let root: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-printpdf-")));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("printDeckPdf", () => {
  it("4.1b runs chromium with the stated args, ending with the file URL of deck.html in the temp folder", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "" });
    await printDeckPdf(HTML, { chromium: "/fake/chrome", run });
    expect(calls).toHaveLength(1);
    const { executable, args, cwd } = firstCall(calls);
    expect(executable).toBe("/fake/chrome");
    expect(args).toEqual([
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-pdf-header-footer",
      `--user-data-dir=${path.join(cwd, "profile")}`,
      `--print-to-pdf=${path.join(cwd, "deck.pdf")}`,
      pathToFileURL(path.join(cwd, "deck.html")).href,
    ]);
  });

  it("4.1b writes the html to deck.html in the temp folder before running", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "" });
    await printDeckPdf(HTML, { chromium: "/fake/chrome", run });
    expect(firstCall(calls).htmlAtRun).toBe(HTML);
  });

  it("4.1b passes a 120000 ms timeout by default", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "" });
    await printDeckPdf(HTML, { chromium: "/fake/chrome", run });
    expect(firstCall(calls).options?.timeoutMs).toBe(120000);
  });

  it("4.1b passes a given timeoutMs to run", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "" });
    await printDeckPdf(HTML, { chromium: "/fake/chrome", run, timeoutMs: 5000 });
    expect(firstCall(calls).options?.timeoutMs).toBe(5000);
  });

  it("4.1b returns the PDF bytes and removes its temp folder", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "" });
    const bytes = await printDeckPdf(HTML, { chromium: "/fake/chrome", run });
    expect(Buffer.from(bytes).equals(PDF)).toBe(true);
    expect(existsSync(firstCall(calls).cwd)).toBe(false);
  });

  it("4.1b rejects with the output tail on a non-zero exit and removes its temp folder", async () => {
    const { run, calls } = fakeRun({ code: 1, output: "[ERROR] could not open display" });
    await expect(printDeckPdf(HTML, { chromium: "/fake/chrome", run }))
      .rejects.toThrow("Chromium could not print the deck: [ERROR] could not open display");
    expect(existsSync(firstCall(calls).cwd)).toBe(false);
  });

  it("4.1b rejects when the run succeeds but writes no PDF, and removes its temp folder", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "printed nothing" }, null);
    await expect(printDeckPdf(HTML, { chromium: "/fake/chrome", run }))
      .rejects.toThrow("Chromium could not print the deck: printed nothing");
    expect(existsSync(firstCall(calls).cwd)).toBe(false);
  });

  it("4.1b rejects when the PDF is empty, and removes its temp folder", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "empty page" }, Buffer.alloc(0));
    await expect(printDeckPdf(HTML, { chromium: "/fake/chrome", run }))
      .rejects.toThrow("Chromium could not print the deck: empty page");
    expect(existsSync(firstCall(calls).cwd)).toBe(false);
  });

  it("4.1b removes its temp folder when run itself rejects", async () => {
    let cwdSeen = "";
    const run = async (_e: string, _a: string[], cwd: string): Promise<RunOutcome> => {
      cwdSeen = cwd;
      throw new Error("spawn failed");
    };
    await expect(printDeckPdf(HTML, { chromium: "/fake/chrome", run })).rejects.toThrow();
    expect(cwdSeen).not.toBe("");
    expect(existsSync(cwdSeen)).toBe(false);
  });
});

describe("exportDeckPdf", () => {
  it("4.1c writes the PDF to out and returns it", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "" });
    const out = path.join(root, "talk.pdf");
    const result = await exportDeckPdf(HTML, { out, find: async () => ({ path: "/fake/chrome", source: "system" }), run, logger: makeLogger() });
    expect(result).toEqual({ kind: "pdf", path: out });
    expect((await fs.readFile(out)).equals(PDF)).toBe(true);
    expect(firstCall(calls).executable).toBe("/fake/chrome");
  });

  it("4.1c with no Chromium writes the HTML beside out and returns the fallback with the stated message", async () => {
    const { run, calls } = fakeRun({ code: 0, output: "" });
    const out = path.join(root, "talk.pdf");
    const result = await exportDeckPdf(HTML, { out, find: async () => undefined, run, logger: makeLogger() });
    const htmlPath = path.join(root, "talk.html");
    expect(result).toEqual({ kind: "fallback", htmlPath, message: NOT_FOUND });
    expect(await fs.readFile(htmlPath, "utf8")).toBe(HTML);
    expect(calls).toHaveLength(0);
  });

  it("4.1c appends .html when out has no .pdf extension", async () => {
    const out = path.join(root, "slides");
    const result = await exportDeckPdf(HTML, { out, find: async () => undefined, logger: makeLogger() });
    const htmlPath = path.join(root, "slides.html");
    expect(result).toEqual({ kind: "fallback", htmlPath, message: NOT_FOUND });
    expect(await fs.readFile(htmlPath, "utf8")).toBe(HTML);
  });

  it("4.1c falls back with the print-failed message when printing rejects, and logs at warn", async () => {
    const { run } = fakeRun({ code: 1, output: "crashed" });
    const logger = makeLogger();
    const out = path.join(root, "talk.pdf");
    const result = await exportDeckPdf(HTML, { out, find: async () => ({ path: "/fake/chrome", source: "system" }), run, logger });
    const htmlPath = path.join(root, "talk.html");
    expect(result.kind).toBe("fallback");
    if (result.kind !== "fallback") { return; }
    expect(result.htmlPath).toBe(htmlPath);
    expect(result.message.startsWith(PRINT_FAILED_START)).toBe(true);
    expect(result.message.endsWith(SECOND_SENTENCE)).toBe(true);
    expect(await fs.readFile(htmlPath, "utf8")).toBe(HTML);
    expect(logger.log.mock.calls.some((call) => call[0] === "WARN")).toBe(true);
  });

  it("A7 gives a PDF through an injected Chromium run", async () => {
    const { run } = fakeRun({ code: 0, output: "" });
    const out = path.join(root, "poster.pdf");
    const result = await exportDeckPdf(HTML, { out, find: async () => ({ path: "/managed/chrome-headless-shell", source: "managed" }), run, logger: makeLogger() });
    expect(result).toEqual({ kind: "pdf", path: out });
    expect((await fs.readFile(out)).equals(PDF)).toBe(true);
  });

  it("A7 with no Chromium gives the print fallback with the Chromium message", async () => {
    const out = path.join(root, "poster.pdf");
    const result = await exportDeckPdf(HTML, { out, find: async () => undefined, logger: makeLogger() });
    expect(result).toEqual({ kind: "fallback", htmlPath: path.join(root, "poster.html"), message: NOT_FOUND });
    expect(existsSync(path.join(root, "poster.html"))).toBe(true);
  });
});
