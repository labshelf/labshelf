// Runs latexdiff and latexmk for real on two small LaTeX folders; skipped where either is not on PATH.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { buildMarkedUpDiff } from "../../../../src/writing/versions/node/index";
import { findExecutable } from "../../../../src/latex/toolchain/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const tex = (body: string): string => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

async function sources(root: string, name: string, body: string): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "main.tex"), tex(body));
  return dir;
}

describe("buildMarkedUpDiff with TeX Live", () => {
  it("compiles a PDF whose source marks the added and deleted words", async () => {
    const [latexdiff, latexmk] = await Promise.all([findExecutable("latexdiff"), findExecutable("latexmk")]);
    if (!latexdiff || !latexmk) { console.warn("latexdiff or latexmk is missing; skipping the real marked-up PDF run"); return; }
    const root = await makeTempDir();
    const beforeDir = await sources(root, "before", "The quick brown fox.");
    const afterDir = await sources(root, "after", "The quick red fox jumps.");
    const outDir = path.join(root, "out");

    const pdf = await buildMarkedUpDiff({
      beforeDir, afterDir, main: "main.tex", outDir, toolchain: { engine: "pdflatex", executable: latexmk }, signal: new AbortController().signal,
    }, fakeLogger());

    expect(pdf).toBe(path.join(outDir, "diff.pdf"));
    expect((await fs.readFile(pdf)).subarray(0, 4).toString()).toBe("%PDF");
    const diff = await fs.readFile(path.join(outDir, "diff.tex"), "utf8");
    expect(diff).toContain("\\DIFdel{brown fox }");
    expect(diff).toContain("\\DIFadd{red fox jumps}");
  }, 60_000);
});
