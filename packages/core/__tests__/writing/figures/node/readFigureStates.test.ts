/** Verifies figure staleness read from a real project folder. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readFigureStates } from "../../../../src/writing/figures/node/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const BASE = 1_700_000_000;

/** Writes a file whose modification time is `BASE + offset` seconds. */
async function put(folder: string, file: string, offset: number): Promise<void> {
  const full = path.join(folder, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, "x");
  await fs.utimes(full, BASE + offset, BASE + offset);
}

const ABLATION = { "fig/ablation.pdf": { run: "python plot.py", inputs: ["plot.py", "results/*.json"] } };

describe("readFigureStates", () => {
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
