// Hidden tests of spec 2.1 for readProjectContext: outline, section, figures, bibliography and 64 KB paging with a cursor.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readProjectContext, type ProjectContextPage, type ProjectContextRequest } from "../../src/decks/deckContext.js";
import { nodeFileReads } from "../../src/writing/project/node/projectReads.js";
import type { ReadyProject } from "../../src/writing/project/projectEntry.js";

const LIMIT = 65536;
const temps: string[] = [];

function makeFolder(files: Record<string, string | Buffer>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-context-"));
  temps.push(root);
  for (const [rel, data] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  }
  return root;
}

function projectAt(folder: string, main: string | undefined, format: "latex" | "typst" = "latex"): ReadyProject {
  return { kind: "ready", folder, location: "external", settings: { format } as unknown as ReadyProject["settings"], main };
}

afterEach(() => {
  while (temps.length > 0) fs.rmSync(temps.pop()!, { recursive: true, force: true });
});

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");
const lines = (page: ProjectContextPage): string[] => page.text.trimEnd().split("\n");

const MAIN_TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Introduction}",
  "Intro text.",
  "\\section{Results}",
  "Results text.",
  "\\input{chapters/methods}",
  "\\end{document}",
  "",
].join("\n");

const METHODS_TEX = [
  "\\section{Methods}",
  "\\subsection{Data}",
  "Data text.",
  "\\subsection{Analysis}",
  "Analysis text.",
  "",
].join("\n");

const REFS_BIB = [
  "@article{smith2020,",
  "  title = {A Study},",
  "  author = {Smith, J.},",
  "  journal = {Journal},",
  "  year = {2020}",
  "}",
  "@misc{notitle,",
  "  year = {2001}",
  "}",
  "",
].join("\n");

const MORE_BIB = [
  "@book{doe2019,",
  "  year = {2019},",
  "  author = {Doe, A.},",
  "  title = {A Book}",
  "}",
  "",
].join("\n");

function latexProject(): ReadyProject {
  const folder = makeFolder({
    "main.tex": MAIN_TEX,
    "chapters/methods.tex": METHODS_TEX,
    "refs.bib": REFS_BIB,
    "extra/more.bib": MORE_BIB,
    "figures/plot.png": Buffer.alloc(100, 1),
    "figures/diagram.svg": "<svg></svg>",
    "figures/scan.jpeg": Buffer.alloc(7, 2),
    "notes.txt": "not a figure",
    "talks/intro/assets/slide.png": Buffer.alloc(5),
    "posters/p/figure.pdf": Buffer.alloc(5),
  });
  return projectAt(folder, "main.tex");
}

const read = (project: ReadyProject, request: ProjectContextRequest) => readProjectContext(nodeFileReads, project, request);

describe("readProjectContext parts", () => {
  it("2.1d outline lists every heading of the main file and its inputs with file and line, indented by level", async () => {
    const page = await read(latexProject(), { part: "outline" });
    expect(lines(page)).toEqual([
      "Introduction  (main.tex:3)",
      "Results  (main.tex:5)",
      "Methods  (chapters/methods.tex:1)",
      "  Data  (chapters/methods.tex:2)",
      "  Analysis  (chapters/methods.tex:4)",
    ]);
    expect(page.cursor).toBeUndefined();
  });

  it("2.1d outline without a main file gives No main file.", async () => {
    const folder = makeFolder({ "notes.txt": "x" });
    const page = await read(projectAt(folder, undefined), { part: "outline" });
    expect(page.text.trim()).toBe("No main file.");
    expect(page.cursor).toBeUndefined();
  });

  it("2.1d section gives the source from the heading up to the next heading of the same level", async () => {
    const page = await read(latexProject(), { part: "section", heading: "Data" });
    expect(page.text).toContain("\\subsection{Data}");
    expect(page.text).toContain("Data text.");
    expect(page.text).not.toContain("Analysis");
    expect(page.text).not.toContain("Methods");
  });

  it("2.1d section of a higher heading runs over its subsections to the end of its file", async () => {
    const page = await read(latexProject(), { part: "section", heading: "Methods" });
    expect(page.text).toContain("\\section{Methods}");
    expect(page.text).toContain("\\subsection{Data}");
    expect(page.text).toContain("Analysis text.");
    expect(page.text).not.toContain("Results");
    expect(page.text).not.toContain("\\end{document}");
  });

  it("2.1d section stops at the next heading of the same level in the main file", async () => {
    const page = await read(latexProject(), { part: "section", heading: "Introduction" });
    expect(page.text).toContain("\\section{Introduction}");
    expect(page.text).toContain("Intro text.");
    expect(page.text).not.toContain("Results");
  });

  it("2.1d section trims the requested heading", async () => {
    const page = await read(latexProject(), { part: "section", heading: "  Analysis  " });
    expect(page.text).toContain("\\subsection{Analysis}");
    expect(page.text).toContain("Analysis text.");
    expect(page.text).not.toContain("Data text.");
  });

  it("2.1d section with an unknown heading says so", async () => {
    const page = await read(latexProject(), { part: "section", heading: "Nope" });
    expect(page.text.trim()).toBe('No section titled "Nope".');
  });

  it("2.1d figures lists image files with their byte sizes, outside talks/ and posters/", async () => {
    const page = await read(latexProject(), { part: "figures" });
    expect(lines(page)).toEqual([
      "figures/diagram.svg  11 bytes",
      "figures/plot.png  100 bytes",
      "figures/scan.jpeg  7 bytes",
    ]);
  });

  it("2.1d figures covers every listed extension", async () => {
    const exts = ["png", "jpg", "jpeg", "gif", "svg", "pdf", "webp", "eps"];
    const files: Record<string, Buffer> = { "main.tex": Buffer.from("\\section{A}\n") };
    exts.forEach((ext, index) => { files[`img/f.${ext}`] = Buffer.alloc(index + 1); });
    files["img/f.tiff"] = Buffer.alloc(3);
    const page = await read(projectAt(makeFolder(files), "main.tex"), { part: "figures" });
    const expected = exts.map((ext, index) => `img/f.${ext}  ${index + 1} bytes`).sort();
    expect(lines(page)).toEqual(expected);
  });

  it("2.1d bibliography gives each .bib file sorted, then its entries with title, author and year", async () => {
    const page = await read(latexProject(), { part: "bibliography" });
    expect(lines(page)).toEqual([
      "# extra/more.bib",
      "@book{doe2019}",
      "  title = A Book",
      "  author = Doe, A.",
      "  year = 2019",
      "# refs.bib",
      "@article{smith2020}",
      "  title = A Study",
      "  author = Smith, J.",
      "  year = 2020",
      "@misc{notitle}",
      "  year = 2001",
    ]);
  });
});

/** Reads every page of a request by following cursors; checks the page bound and the cursor offsets on the way. */
async function readAllPages(project: ReadyProject, request: ProjectContextRequest): Promise<ProjectContextPage[]> {
  const pages: ProjectContextPage[] = [];
  let offset = 0;
  let cursor: string | undefined;
  do {
    const page = await read(project, cursor === undefined ? request : { ...request, cursor });
    expect(bytes(page.text)).toBeLessThanOrEqual(LIMIT);
    expect(bytes(page.text)).toBeGreaterThan(0);
    offset += bytes(page.text);
    if (page.cursor !== undefined) expect(page.cursor).toBe(String(offset));
    pages.push(page);
    cursor = page.cursor;
    if (pages.length > 100) throw new Error("cursor does not advance");
  } while (cursor !== undefined);
  return pages;
}

const SECTIONS = 5000;
const title = (i: number): string => `Seção número ${String(i).padStart(4, "0")} €`;

function bigOutlineProject(): ReadyProject {
  const tex = Array.from({ length: SECTIONS }, (_, i) => `\\section{${title(i)}}\nText ${i}.\n`).join("");
  return projectAt(makeFolder({ "main.tex": tex }), "main.tex");
}

describe("readProjectContext paging", () => {
  it("2.1e an outline over 64 KB comes in pages of at most 65536 bytes that give the whole text exactly once", async () => {
    const pages = await readAllPages(bigOutlineProject(), { part: "outline" });
    expect(pages.length).toBeGreaterThanOrEqual(3);
    const expected = Array.from({ length: SECTIONS }, (_, i) => `${title(i)}  (main.tex:${2 * i + 1})`);
    expect(pages.map((p) => p.text).join("").trimEnd().split("\n")).toEqual(expected);
    expect(pages[pages.length - 1]!.cursor).toBeUndefined();
  });

  it("2.1e each page but the last is cut at a line break close to the limit", async () => {
    const pages = await readAllPages(bigOutlineProject(), { part: "outline" });
    const longestLine = Math.max(...pages.map((p) => p.text).join("").split("\n").map((l) => bytes(l)));
    for (let i = 0; i < pages.length - 1; i += 1) {
      const text = pages[i]!.text;
      const next = pages[i + 1]!.text;
      expect(text.endsWith("\n") || next.startsWith("\n")).toBe(true);
      expect(bytes(text)).toBeGreaterThan(LIMIT - longestLine - 2);
    }
  });

  it("2.1e page 1 is the request without cursor and the cursor of page 1 starts page 2", async () => {
    const project = bigOutlineProject();
    const first = await read(project, { part: "outline" });
    expect(first.cursor).toBe(String(bytes(first.text)));
    const cursor = first.cursor;
    if (cursor === undefined) throw new Error("page 1 has no cursor");
    const second = await read(project, { part: "outline", cursor });
    expect(second.text.length).toBeGreaterThan(0);
    const expected = Array.from({ length: SECTIONS }, (_, i) => `${title(i)}  (main.tex:${2 * i + 1})`).join("\n");
    expect(first.text.startsWith(title(0))).toBe(true);
    expect(expected.startsWith((first.text + second.text).trimEnd())).toBe(true);
  });

  it("2.1e a single line longer than a page is cut at a code point boundary", async () => {
    const long = "€".repeat(50000);
    const tex = `\\section{Long}\n${long}\n\\section{After}\nEnd.\n`;
    const project = projectAt(makeFolder({ "main.tex": tex }), "main.tex");
    const pages = await readAllPages(project, { part: "section", heading: "Long" });
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) expect(page.text).not.toContain("\uFFFD");
    const whole = pages.map((p) => p.text).join("");
    expect(whole).toContain(`\\section{Long}\n${long}`);
    expect(whole.split("\\section{Long}")).toHaveLength(2);
    expect(whole.split("€")).toHaveLength(50001);
    expect(whole).not.toContain("After");
  });

  it("2.1e a bibliography over 64 KB pages the same way", async () => {
    const bib = Array.from({ length: 2000 }, (_, i) => `@article{key${i},\n  title = {Title ${i} ü},\n  year = {2000}\n}\n`).join("");
    const project = projectAt(makeFolder({ "main.tex": "\\section{A}\n", "refs.bib": bib }), "main.tex");
    const pages = await readAllPages(project, { part: "bibliography" });
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const whole = pages.map((p) => p.text).join("").trimEnd().split("\n");
    const expected = ["# refs.bib", ...Array.from({ length: 2000 }, (_, i) => [`@article{key${i}}`, `  title = Title ${i} ü`, "  year = 2000"]).flat()];
    expect(whole).toEqual(expected);
  });

  it("2.1e a cursor that is not a decimal offset throws RangeError", async () => {
    const project = bigOutlineProject();
    for (const cursor of ["abc", "-1", "1.5", "0x10", "12abc"]) {
      await expect(read(project, { part: "outline", cursor })).rejects.toThrow(RangeError);
    }
  });

  it("2.1e a cursor beyond the text throws RangeError", async () => {
    const project = bigOutlineProject();
    await expect(read(project, { part: "outline", cursor: "999999999" })).rejects.toThrow(RangeError);
    const small = latexProject();
    await expect(read(small, { part: "outline", cursor: "100000" })).rejects.toThrow(RangeError);
  });
});
