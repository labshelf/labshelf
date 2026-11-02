// Hidden tests of spec 4.3: `labshelf deck export` writes single-file HTML or a PDF of a talk folder, with the print fallback.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import type { ILogger } from "@labshelf/core";

import { runDeck } from "../../../src/cli/deck/deckCommand";
import { UsageError, type Output } from "../../../src/cli/usage";
import { cleanupTempDirs, fakePdfBytes, makeTempDir } from "../../fixtures/library";

afterEach(cleanupTempDirs);

interface RunOutcomeLike { code: number | null; output: string }

const FALLBACK_MESSAGE = "No Chromium was found, so the deck opened for printing. Install Chrome or Chromium to save the PDF automatically.";

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";

const HEAD = [
  "<head>",
  '<meta charset="utf-8">',
  "<title>Sample</title>",
  '<link rel="stylesheet" href="theme.css" data-deck-theme>',
  "</head>",
].join("\n");

const SAMPLE_TALK = [
  "<!doctype html>",
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
  HEAD,
  "<body>",
  "<section data-slide>",
  '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>',
  "<aside data-notes>Say hello.</aside>",
  "</section>",
  "<section data-slide>",
  '<div data-block="body" style="left: 120px; top: 320px; width: 1680px; height: 600px;"><p>Some text.</p><div data-math="display">\\frac{a}{b}</div><img src="assets/plot.png" alt="Plot"></div>',
  "</section>",
  "</body>",
  "</html>",
  "",
].join("\n");

/** A deck exportDeckHtml rejects: a script element is DECK013. */
const BROKEN_TALK = SAMPLE_TALK.replace("</body>", "<script>alert(1)</script>\n</body>");

// A 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const makeLogger = (): ILogger => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });

function makeIo(): Output & { outs: string[]; errs: string[] } {
  const outs: string[] = [];
  const errs: string[] = [];
  return { out: (text: string) => { outs.push(text); }, err: (text: string) => { errs.push(text); }, columns: 80, outs, errs };
}

/** A project folder holding talks/<name>/ with deck.html, theme.css and assets/plot.png. */
async function makeDeck(name = "intro", html = SAMPLE_TALK): Promise<{ root: string; folder: string; deckHtml: string }> {
  const root = await makeTempDir("labshelf-deck-cli-");
  const folder = path.join(root, "talks", name);
  await fs.mkdir(path.join(folder, "assets"), { recursive: true });
  const deckHtml = path.join(folder, "deck.html");
  await fs.writeFile(deckHtml, html);
  await fs.writeFile(path.join(folder, "theme.css"), THEME);
  await fs.writeFile(path.join(folder, "assets", "plot.png"), PNG);
  return { root, folder, deckHtml };
}

/** A Chromium run that writes a PDF at the --print-to-pdf= path it receives. */
function fakeRun() {
  const calls: Array<{ executable: string; args: string[] }> = [];
  const run = async (executable: string, args: string[], _cwd: string, _signal: AbortSignal): Promise<RunOutcomeLike> => {
    calls.push({ executable, args });
    const flag = args.find((arg) => arg.startsWith("--print-to-pdf="));
    if (flag) await fs.writeFile(flag.slice("--print-to-pdf=".length), fakePdfBytes("deck"));
    return { code: 0, output: "" };
  };
  return { run, calls };
}

// Loaded at run time so the suite compiles before findSystemChromium (spec 4.1) exists.
const DECKS_NODE: string = "@labshelf/core/decks/node";
type FindSystemChromium = () => Promise<{ path: string; source: string } | undefined>;

const fakeChromium = async () => ({ path: "/fake/chrome", source: "system" as const });

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(() => true, () => false);
}

describe("labshelf deck export", () => {
  it("4.3a --html on a folder writes <folder name>.html beside the deck and prints the path", async () => {
    const { folder } = await makeDeck("intro");
    const io = makeIo();
    const open = jest.fn();
    const code = await runDeck({ logger: makeLogger() }, ["export", folder], { html: true }, io, { open });
    expect(code).toBe(0);
    const out = path.join(folder, "intro.html");
    const written = await fs.readFile(out, "utf8");
    expect(written).toMatch(/^<!doctype html>/i);
    expect(written).toContain("<h1>Title</h1>");
    expect(written).toContain("--deck-bg: #ffffff");
    expect(written).toContain("data:image/png;base64,");
    expect(io.outs.join("\n")).toContain(`Wrote ${out}`);
    expect(open).not.toHaveBeenCalled();
  });

  it("4.3a --html on a deck.html path writes the same default file", async () => {
    const { folder, deckHtml } = await makeDeck("intro");
    const io = makeIo();
    const code = await runDeck({ logger: makeLogger() }, ["export", deckHtml], { html: true }, io, { open: jest.fn() });
    expect(code).toBe(0);
    const out = path.join(folder, "intro.html");
    expect(await exists(out)).toBe(true);
    expect(io.outs.join("\n")).toContain(`Wrote ${out}`);
  });

  it("4.3a --html with --out writes to that path and prints it", async () => {
    const { folder } = await makeDeck("intro");
    const elsewhere = await makeTempDir("labshelf-deck-out-");
    const out = path.join(elsewhere, "talk.html");
    const io = makeIo();
    const code = await runDeck({ logger: makeLogger() }, ["export", folder], { html: true, out }, io, { open: jest.fn() });
    expect(code).toBe(0);
    expect(await fs.readFile(out, "utf8")).toContain("<h1>Title</h1>");
    expect(await exists(path.join(folder, "intro.html"))).toBe(false);
    expect(io.outs.join("\n")).toContain(`Wrote ${out}`);
  });

  it("4.3b --pdf with an injected Chromium writes the PDF to the default path and prints it", async () => {
    const { folder } = await makeDeck("intro");
    const { run, calls } = fakeRun();
    const open = jest.fn();
    const io = makeIo();
    const code = await runDeck({ logger: makeLogger() }, ["export", folder], { pdf: true }, io, { find: fakeChromium, run: run as never, open });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.executable).toBe("/fake/chrome");
    const out = path.join(folder, "intro.pdf");
    expect(Buffer.from(await fs.readFile(out))).toEqual(Buffer.from(fakePdfBytes("deck")));
    expect(io.outs.join("\n")).toContain(`Wrote ${out}`);
    expect(open).not.toHaveBeenCalled();
  });

  it("4.3b --pdf with --out writes the PDF there", async () => {
    const { folder } = await makeDeck("intro");
    const elsewhere = await makeTempDir("labshelf-deck-out-");
    const out = path.join(elsewhere, "slides.pdf");
    const { run } = fakeRun();
    const io = makeIo();
    const code = await runDeck({ logger: makeLogger() }, ["export", folder], { pdf: true, out }, io, { find: fakeChromium, run: run as never, open: jest.fn() });
    expect(code).toBe(0);
    expect(Buffer.from(await fs.readFile(out)).subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(io.outs.join("\n")).toContain(`Wrote ${out}`);
  });

  it("4.3b --pdf with no Chromium opens the HTML with #print, prints the message and exits 0", async () => {
    const { folder } = await makeDeck("intro");
    const { run, calls } = fakeRun();
    const open = jest.fn();
    const io = makeIo();
    const code = await runDeck({ logger: makeLogger() }, ["export", folder], { pdf: true }, io, { find: async () => undefined, run: run as never, open });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    const htmlPath = path.join(folder, "intro.html");
    expect(await fs.readFile(htmlPath, "utf8")).toContain("<h1>Title</h1>");
    expect(await exists(path.join(folder, "intro.pdf"))).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(`${pathToFileURL(htmlPath).href}#print`);
    expect([...io.outs, ...io.errs].join("\n")).toContain(FALLBACK_MESSAGE);
  });

  it("4.3c a missing path is a usage error", async () => {
    const open = jest.fn();
    await expect(runDeck({ logger: makeLogger() }, ["export"], { html: true }, makeIo(), { open })).rejects.toBeInstanceOf(UsageError);
    expect(open).not.toHaveBeenCalled();
  });

  it("4.3c an unknown or missing subcommand is a usage error", async () => {
    const { folder } = await makeDeck("intro");
    await expect(runDeck({ logger: makeLogger() }, ["publish", folder], { html: true }, makeIo(), { open: jest.fn() })).rejects.toBeInstanceOf(UsageError);
    await expect(runDeck({ logger: makeLogger() }, [], { html: true }, makeIo(), { open: jest.fn() })).rejects.toBeInstanceOf(UsageError);
    expect(await exists(path.join(folder, "intro.html"))).toBe(false);
  });

  it("4.3c neither --pdf nor --html is a usage error", async () => {
    const { folder } = await makeDeck("intro");
    await expect(runDeck({ logger: makeLogger() }, ["export", folder], {}, makeIo(), { open: jest.fn() })).rejects.toBeInstanceOf(UsageError);
    expect(await exists(path.join(folder, "intro.html"))).toBe(false);
  });

  it("4.3c both --pdf and --html is a usage error", async () => {
    const { folder } = await makeDeck("intro");
    const { run, calls } = fakeRun();
    await expect(runDeck({ logger: makeLogger() }, ["export", folder], { pdf: true, html: true }, makeIo(), { find: fakeChromium, run: run as never, open: jest.fn() }))
      .rejects.toBeInstanceOf(UsageError);
    expect(calls).toHaveLength(0);
    expect(await exists(path.join(folder, "intro.html"))).toBe(false);
    expect(await exists(path.join(folder, "intro.pdf"))).toBe(false);
  });

  it("4.3c a deck with errors exits 1 and writes nothing", async () => {
    const { folder } = await makeDeck("broken", BROKEN_TALK);
    const { run, calls } = fakeRun();
    const open = jest.fn();
    const io = makeIo();
    const htmlCode = await runDeck({ logger: makeLogger() }, ["export", folder], { html: true }, io, { open });
    expect(htmlCode).toBe(1);
    const pdfCode = await runDeck({ logger: makeLogger() }, ["export", folder], { pdf: true }, makeIo(), { find: fakeChromium, run: run as never, open });
    expect(pdfCode).toBe(1);
    expect(calls).toHaveLength(0);
    expect(open).not.toHaveBeenCalled();
    expect(await exists(path.join(folder, "broken.html"))).toBe(false);
    expect(await exists(path.join(folder, "broken.pdf"))).toBe(false);
  });

  it("A7 with a system Chromium the PDF has the deck's page size (skipped when none is found)", async () => {
    const { findSystemChromium } = (await import(DECKS_NODE)) as { findSystemChromium?: FindSystemChromium };
    if (findSystemChromium && !(await findSystemChromium())) return; // no Chromium on this machine: nothing to check
    const { folder } = await makeDeck("intro");
    const open = jest.fn();
    const io = makeIo();
    // No find injected: the command's default finds the system Chromium.
    const code = await runDeck({ logger: makeLogger() }, ["export", folder], { pdf: true }, io, { open });
    expect(code).toBe(0);
    expect(open).not.toHaveBeenCalled();
    const bytes = Buffer.from(await fs.readFile(path.join(folder, "intro.pdf")));
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const boxes = [...bytes.toString("latin1").matchAll(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g)];
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      const width = Number(box[3]) - Number(box[1]);
      const height = Number(box[4]) - Number(box[2]);
      expect(Math.abs(width - 1440)).toBeLessThanOrEqual(1);
      expect(Math.abs(height - 810)).toBeLessThanOrEqual(1);
    }
  }, 180000);
});
