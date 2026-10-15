// Tests which PDF a project's preview shows: next to main for LaTeX, in the build folder for Typst.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { builtPdf } from "../../../src/writing/preview/builtPdf";
import { readyEntry } from "../../support/writingFixtures";

type Project = Parameters<typeof builtPdf>[0];
let dir: string;
let cache: string;
let previousCache: string | undefined;

const typst = (over = {}) => readyEntry(dir, { main: "doc/main.typ", settings: { id: "paper", format: "typst" }, ...over }) as Project;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-pdf-"));
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-pdf-cache-"));
  previousCache = process.env["XDG_CACHE_HOME"];
  process.env["XDG_CACHE_HOME"] = cache;
});

afterEach(() => {
  if (previousCache === undefined) { delete process.env["XDG_CACHE_HOME"]; } else { process.env["XDG_CACHE_HOME"] = previousCache; }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(cache, { recursive: true, force: true });
});

describe("builtPdf", () => {
  it("returns the Typst preview PDF from the build folder, not the one next to main", async () => {
    const preview = path.join(cache, "labshelf", "builds", "paper", "main.pdf");
    fs.mkdirSync(path.dirname(preview), { recursive: true });
    fs.writeFileSync(preview, "%PDF");
    fs.mkdirSync(path.join(dir, "doc"));
    fs.writeFileSync(path.join(dir, "doc", "main.pdf"), "%PDF");
    expect(await builtPdf(typst())).toBe(preview);
  });

  it("returns undefined for a Typst project whose preview was not compiled, even with a saved PDF next to main", async () => {
    fs.mkdirSync(path.join(dir, "doc"));
    fs.writeFileSync(path.join(dir, "doc", "main.pdf"), "%PDF");
    expect(await builtPdf(typst())).toBeUndefined();
  });

  it("returns the PDF next to the main file of a LaTeX project, or undefined when it is missing", async () => {
    const latex = readyEntry(dir, { main: "doc/main.tex" }) as Project;
    expect(await builtPdf(latex)).toBeUndefined();
    fs.mkdirSync(path.join(dir, "doc"));
    fs.writeFileSync(path.join(dir, "doc", "main.pdf"), "%PDF");
    expect(await builtPdf(latex)).toBe(path.join(dir, "doc", "main.pdf"));
  });

  it("returns undefined without a project or a main file", async () => {
    expect(await builtPdf(undefined)).toBeUndefined();
    expect(await builtPdf(typst({ main: undefined }))).toBeUndefined();
  });
});
