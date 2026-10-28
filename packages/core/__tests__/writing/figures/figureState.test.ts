/** Verifies figure staleness, input pattern matching and staleness read from a project folder's file modification times. */
import { posixPathOps } from "../../../src/path/index";
import { deriveFigureBuildState, isGlobPattern, isInputPatternMatch, readFigureBuildStates as readStates } from "../../../src/writing/figures/index";
import type { FigureRecipe } from "../../../src/writing/project/index";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

describe("deriveFigureBuildState", () => {
  it("is missing when the figure file does not exist, whatever the inputs", () => {
    expect(deriveFigureBuildState({ figureMtimeMs: undefined, inputs: [{ path: "a.py", mtimeMs: 1 }], missingInputs: [] }))
      .toEqual({ status: "missing", missingInputs: [] });
  });

  it("is stale and lists exactly the inputs newer than the figure", () => {
    const state = deriveFigureBuildState({
      figureMtimeMs: 100,
      inputs: [{ path: "old.json", mtimeMs: 50 }, { path: "plot.py", mtimeMs: 101 }, { path: "new.json", mtimeMs: 500 }],
      missingInputs: [],
    });
    expect(state).toEqual({ status: "stale", newerInputs: ["plot.py", "new.json"], missingInputs: [] });
  });

  it("is fresh when no input is newer, including an input of the same time", () => {
    expect(deriveFigureBuildState({ figureMtimeMs: 100, inputs: [{ path: "a.py", mtimeMs: 100 }], missingInputs: [] }))
      .toEqual({ status: "fresh", missingInputs: [] });
  });

  it("reports a missing literal input without making the figure stale", () => {
    expect(deriveFigureBuildState({ figureMtimeMs: 100, inputs: [], missingInputs: ["gone.py"] }))
      .toEqual({ status: "fresh", missingInputs: ["gone.py"] });
  });
});

describe("isInputPatternMatch", () => {
  it("matches a literal path exactly", () => {
    expect(isInputPatternMatch("plot.py", "plot.py")).toBe(true);
    expect(isInputPatternMatch("plot.py", "src/plot.py")).toBe(false);
    expect(isInputPatternMatch("plot.py", "plot.pyc")).toBe(false);
  });

  it("reads ./ as the project folder", () => {
    expect(isInputPatternMatch("./plot.py", "plot.py")).toBe(true);
  });

  it("lets * match inside one segment only", () => {
    expect(isInputPatternMatch("results/*.json", "results/a.json")).toBe(true);
    expect(isInputPatternMatch("results/*.json", "results/.json")).toBe(true);
    expect(isInputPatternMatch("results/*.json", "results/deep/a.json")).toBe(false);
    expect(isInputPatternMatch("results/*.json", "results/a.csv")).toBe(false);
    expect(isInputPatternMatch("a*b*c", "aXXbYYc")).toBe(true);
    expect(isInputPatternMatch("a*b*c", "aXXbYY")).toBe(false);
  });

  it("lets ? match exactly one character of a segment", () => {
    expect(isInputPatternMatch("run?.csv", "run1.csv")).toBe(true);
    expect(isInputPatternMatch("run?.csv", "run.csv")).toBe(false);
    expect(isInputPatternMatch("run?.csv", "run12.csv")).toBe(false);
    expect(isInputPatternMatch("run?", "run/")).toBe(false);
  });

  it("lets ** match zero segments", () => {
    expect(isInputPatternMatch("data/**/x.csv", "data/x.csv")).toBe(true);
    expect(isInputPatternMatch("**/x.csv", "x.csv")).toBe(true);
  });

  it("lets ** match many segments", () => {
    expect(isInputPatternMatch("data/**/x.csv", "data/a/b/c/x.csv")).toBe(true);
    expect(isInputPatternMatch("data/**", "data/a/b.csv")).toBe(true);
    expect(isInputPatternMatch("data/**/x.csv", "other/a/x.csv")).toBe(false);
    expect(isInputPatternMatch("data/**/x.csv", "data/a/y.csv")).toBe(false);
  });

  it("escapes nothing: regex characters are literal", () => {
    expect(isInputPatternMatch("a+b(1).py", "a+b(1).py")).toBe(true);
    expect(isInputPatternMatch("a.py", "aXpy")).toBe(false);
  });
});

describe("isGlobPattern", () => {
  it("tells a literal path from a pattern", () => {
    expect(isGlobPattern("plot.py")).toBe(false);
    expect(isGlobPattern("results/*.json")).toBe(true);
    expect(isGlobPattern("a?.py")).toBe(true);
    expect(isGlobPattern("**/x")).toBe(true);
  });
});

const BASE = 1_700_000_000;
const DIR = "/p";

/** A project folder in memory; `put` writes a file whose modification time is `BASE + offset` seconds. */
async function makeTempDir(): Promise<MemoryLibraryFs> {
  const memory = new MemoryLibraryFs();
  await memory.ensureDir(DIR);
  return memory;
}

async function put(memory: MemoryLibraryFs, file: string, offset: number): Promise<void> {
  await memory.writeText(`${DIR}/${file}`, "x");
  memory.mtimes.set(`${DIR}/${file}`, BASE + offset);
}

const readFigureStates = (memory: MemoryLibraryFs, figures: Readonly<Record<string, FigureRecipe>>) =>
  readStates({ fs: memory, paths: posixPathOps }, DIR, figures);

const ABLATION = { "fig/ablation.pdf": { run: "python plot.py", inputs: ["plot.py", "results/*.json"] } };

describe("readFigureBuildStates", () => {
  it("is missing when the figure file does not exist", async () => {
    const dir = await makeTempDir();
    await put(dir, "plot.py", 0);
    expect(await readFigureStates(dir, ABLATION)).toEqual({ "fig/ablation.pdf": { status: "missing", missingInputs: [] } });
  });

  it("is fresh when the figure is newer than every input", async () => {
    const dir = await makeTempDir();
    await put(dir, "plot.py", 0);
    await put(dir, "results/a.json", 1);
    await put(dir, "fig/ablation.pdf", 10);
    expect(await readFigureStates(dir, ABLATION)).toEqual({ "fig/ablation.pdf": { status: "fresh", missingInputs: [] } });
  });

  it("is stale when a literal input is newer, and names it", async () => {
    const dir = await makeTempDir();
    await put(dir, "fig/ablation.pdf", 10);
    await put(dir, "plot.py", 20);
    await put(dir, "results/a.json", 1);
    expect(await readFigureStates(dir, ABLATION)).toEqual({
      "fig/ablation.pdf": { status: "stale", newerInputs: ["plot.py"], missingInputs: [] },
    });
  });

  it("is stale when a glob-matched input in a subfolder is newer", async () => {
    const dir = await makeTempDir();
    const figures = { "f.pdf": { run: "make", inputs: ["data/**/*.csv"] } };
    await put(dir, "f.pdf", 10);
    await put(dir, "data/a/b/run.csv", 11);
    await put(dir, "data/old.csv", 1);
    expect(await readFigureStates(dir, figures)).toEqual({
      "f.pdf": { status: "stale", newerInputs: ["data/a/b/run.csv"], missingInputs: [] },
    });
  });

  it("does not look inside hidden folders or node_modules", async () => {
    const dir = await makeTempDir();
    const figures = { "f.pdf": { run: "make", inputs: ["**/*.json"] } };
    await put(dir, "f.pdf", 10);
    await put(dir, ".git/x.json", 20);
    await put(dir, "node_modules/pkg/y.json", 20);
    expect(await readFigureStates(dir, figures)).toEqual({ "f.pdf": { status: "fresh", missingInputs: [] } });
  });

  it("lists a missing literal input without making the figure stale", async () => {
    const dir = await makeTempDir();
    await put(dir, "fig/ablation.pdf", 10);
    expect(await readFigureStates(dir, ABLATION)).toEqual({
      "fig/ablation.pdf": { status: "fresh", missingInputs: ["plot.py"] },
    });
  });

  it("is fresh when a glob matches nothing", async () => {
    const dir = await makeTempDir();
    await put(dir, "f.pdf", 10);
    expect(await readFigureStates(dir, { "f.pdf": { run: "make", inputs: ["none/*.json"] } }))
      .toEqual({ "f.pdf": { status: "fresh", missingInputs: [] } });
  });

  it("reads every figure of the project", async () => {
    const dir = await makeTempDir();
    await put(dir, "a.pdf", 10);
    await put(dir, "in.txt", 5);
    const states = await readFigureStates(dir, {
      "a.pdf": { run: "x", inputs: ["in.txt"] }, "b.pdf": { run: "y", inputs: [] },
    });
    expect(states["a.pdf"]?.status).toBe("fresh");
    expect(states["b.pdf"]?.status).toBe("missing");
  });
});
