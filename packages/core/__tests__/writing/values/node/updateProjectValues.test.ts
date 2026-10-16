/** Verifies the values file is written next to the main file, loaded once and rewritten only on change. */
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { OpenSources } from "../../../../src/writing/citations/node/index";
import type { ProjectSettings } from "../../../../src/writing/project/index";
import { VALUES_HEADER } from "../../../../src/writing/values/index";
import { readProjectValues, updateProjectValues } from "../../../../src/writing/values/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const DOCUMENT = "\\documentclass{article}\n\\begin{document}\nAccuracy \\lsvalue{results.acc}%\n\\end{document}\n";

async function folderWith(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir();
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), text);
  }
  return dir;
}

const read = (dir: string, name: string): Promise<string> => fs.readFile(path.join(dir, name), "utf8");
const project = (folder: string, main: string | undefined, over: Partial<ProjectSettings> = {}) =>
  ({ folder, main, settings: { id: "p", format: "latex" as const, values: ["results.json"], ...over } });

describe("readProjectValues", () => {
  it("reads the listed files in order and logs a missing or invalid file with the project and path", async () => {
    const dir = await folderWith({ "results.json": '{"acc":0.9}', "bad.json": "{oops", "data/more.json": '{"n":2}' });
    const logger = fakeLogger();
    const leaves = await readProjectValues(
      { folder: dir, settings: { id: "p", format: "latex", values: ["./results.json", "bad.json", "gone.json", "data\\more.json"] } },
      logger,
    );
    expect(leaves.map((leaf) => [leaf.key, leaf.file])).toEqual([["results.acc", "results.json"], ["more.n", "data/more.json"]]);
    expect(logger.logs.filter((entry) => entry.level === "WARN" && entry.message === "value file skipped")).toHaveLength(2);
  });

  it("logs the keys it skips", async () => {
    const dir = await folderWith({ "results.json": '{"a b":1,"c":2}' });
    const logger = fakeLogger();
    const leaves = await readProjectValues({ folder: dir, settings: { id: "p", format: "latex", values: ["results.json"] } }, logger);
    expect(leaves.map((leaf) => leaf.key)).toEqual(["results.c"]);
    expect(logger.logs.map((entry) => entry.message)).toEqual([expect.stringContaining("value keys skipped")]);
  });

  it("reads only the first of two files with the same name, so their keys cannot collide", async () => {
    const dir = await folderWith({ "results.json": '{"acc":1}', "old/results.json": '{"acc":2}' });
    const logger = fakeLogger();
    const settings: ProjectSettings = { id: "p", format: "latex", values: ["results.json", "old/results.json"] };
    const leaves = await readProjectValues({ folder: dir, settings }, logger);
    expect(leaves.map((leaf) => [leaf.key, leaf.value])).toEqual([["results.acc", 1]]);
    expect(logger.logs.map((entry) => entry.message)).toEqual([expect.stringContaining("same name")]);
  });
});

describe("updateProjectValues", () => {
  it("writes labshelf-values.tex next to the main file and loads it before \\begin{document}", async () => {
    const dir = await folderWith({ "results.json": '{"acc":0.91,"name":"a_b"}', "paper/main.tex": DOCUMENT });
    const result = await updateProjectValues(project(dir, "paper/main.tex"), fakeLogger());
    expect(result).toMatchObject({ written: true, mainLine: "added" });
    expect(result.leaves.map((leaf) => leaf.key)).toEqual(["results.acc", "results.name"]);
    const values = await read(dir, "paper/labshelf-values.tex");
    expect(values.split("\n")[0]).toBe(VALUES_HEADER);
    expect(values).toContain("\\csname lsv@results.name\\endcsname{a\\_b}");
    expect(await read(dir, "paper/main.tex")).toBe(DOCUMENT.replace("\\begin", "\\input{labshelf-values}\n\\begin"));
  });

  it("does not rewrite an unchanged file and does not touch the main file again", async () => {
    const dir = await folderWith({ "results.json": '{"acc":1}', "main.tex": DOCUMENT });
    await updateProjectValues(project(dir, "main.tex"), fakeLogger());
    const valuesFile = path.join(dir, "labshelf-values.tex");
    const stamp = new Date(2020, 0, 1);
    await fs.utimes(valuesFile, stamp, stamp);
    const mainBefore = await read(dir, "main.tex");
    const again = await updateProjectValues(project(dir, "main.tex"), fakeLogger());
    expect(again).toMatchObject({ written: false, mainLine: "present" });
    expect((await fs.stat(valuesFile)).mtime).toEqual(stamp);
    expect(await read(dir, "main.tex")).toBe(mainBefore);
  });

  it("rewrites the file when a value changes", async () => {
    const dir = await folderWith({ "results.json": '{"acc":1}', "main.tex": DOCUMENT });
    await updateProjectValues(project(dir, "main.tex"), fakeLogger());
    await fs.writeFile(path.join(dir, "results.json"), '{"acc":2}');
    expect((await updateProjectValues(project(dir, "main.tex"), fakeLogger())).written).toBe(true);
    expect(await read(dir, "labshelf-values.tex")).toContain("{2}");
  });

  it("skips an invalid value file and still writes the macro, so LaTeX warns about the unknown key", async () => {
    const dir = await folderWith({ "results.json": "not json", "main.tex": DOCUMENT });
    const logger = fakeLogger();
    const result = await updateProjectValues(project(dir, "main.tex"), logger);
    expect(result).toMatchObject({ written: true, leaves: [] });
    expect(await read(dir, "labshelf-values.tex")).toContain("\\providecommand{\\lsvalue}");
    expect(logger.logs.some((entry) => entry.message === "value file skipped")).toBe(true);
  });

  it("warns and leaves a main file without \\begin{document} as it was", async () => {
    const dir = await folderWith({ "results.json": "{}", "main.tex": "\\section{A}\n" });
    const logger = fakeLogger();
    expect((await updateProjectValues(project(dir, "main.tex"), logger)).mainLine).toBe("no-document");
    expect(await read(dir, "main.tex")).toBe("\\section{A}\n");
    expect(logger.logs.some((entry) => entry.level === "WARN")).toBe(true);
  });

  it("edits an open main file in the editor instead of on disk", async () => {
    const dir = await folderWith({ "results.json": "{}", "main.tex": DOCUMENT });
    const mainPath = path.join(dir, "main.tex");
    const edits: Array<[string, string]> = [];
    const open: OpenSources = {
      text: (file) => (file === mainPath ? `${DOCUMENT}% unsaved\n` : undefined),
      replace: async (file, text) => { edits.push([file, text]); return true; },
    };
    expect((await updateProjectValues(project(dir, "main.tex"), fakeLogger(), open)).mainLine).toBe("added");
    expect(edits).toEqual([[mainPath, expect.stringContaining("% unsaved")]]);
    expect(await read(dir, "main.tex")).toBe(DOCUMENT);
  });

  it("does nothing for a Typst project, a project without values or without a main file", async () => {
    const dir = await folderWith({ "results.json": "{}", "main.tex": DOCUMENT });
    const outcomes = [
      await updateProjectValues(project(dir, "main.tex", { format: "typst" }), fakeLogger()),
      await updateProjectValues(project(dir, "main.tex", { values: [] }), fakeLogger()),
      await updateProjectValues(project(dir, undefined), fakeLogger()),
    ];
    expect(outcomes.map((outcome) => [outcome.written, outcome.mainLine])).toEqual([[false, "not-needed"], [false, "not-needed"], [false, "no-main"]]);
    expect(await fs.readdir(dir)).toEqual(["main.tex", "results.json"]);
  });
});

const has = (command: string): boolean => {
  try { execFileSync("which", [command], { stdio: "ignore" }); return true; } catch { return false; }
};

// Compiles the generated file with a real engine; skipped where pdflatex or pdftotext is not installed.
(has("pdflatex") && has("pdftotext") ? describe : describe.skip)("generated file under pdflatex", () => {
  it("prints the value, escaped text and ?? for an unknown key", async () => {
    const main = DOCUMENT.replace("\\end{document}", "Name \\lsvalue{results.name}; Top \\lsvalue{results.nested.0}; Miss \\lsvalue{results.nope}\n\\end{document}");
    const dir = await folderWith({
      "results.json": '{"acc":0.9137,"name":"a_b & 50% #1 \\\\ {x} $ ~ ^","nested":[7]}', "main.tex": main,
    });
    await updateProjectValues(project(dir, "main.tex"), fakeLogger());
    execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "main.tex"], { cwd: dir, stdio: "ignore" });
    const text = execFileSync("pdftotext", [path.join(dir, "main.pdf"), "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
    expect(text).toContain("Accuracy 0.9137");
    // pdftotext reads the underscore, tilde and circumflex glyphs as a space, a tilde accent and a hat accent.
    expect(text).toContain("Name a b & 50% #1 \\ {x} $");
    expect(text).toContain("Top 7");
    expect(text).toContain("Miss ??");
    expect(await read(dir, "main.log")).toContain("Package labshelf Warning: Unknown value results.nope");
  }, 60_000);
});
