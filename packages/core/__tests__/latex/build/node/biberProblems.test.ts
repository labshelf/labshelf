/** Verifies a failed biber step of latexmk becomes build problems carrying biber's own error messages. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { biberProblems } from "../../../../src/latex/build/node/biberProblems";

const FAILED = "Latexmk: Error return from 'biber /o/main'\nLatexmk: Errors, so I did not complete making targets";

describe("biberProblems", () => {
  let outDir: string;
  beforeEach(() => { outDir = fs.mkdtempSync(path.join(os.tmpdir(), "biber-problems-")); });
  afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

  it("reports the .blg's errors on the main file when latexmk says biber failed", async () => {
    fs.writeFileSync(path.join(outDir, "main.blg"), "[0] Config.pm:307> INFO - This is Biber 2.22\n[9] Utils.pm:411> ERROR - Cannot find 'x.bib'!\n");
    expect(await biberProblems(FAILED, outDir, "main", "/p/main.tex")).toEqual([{ severity: "error", message: "Biber: Cannot find 'x.bib'!", file: "/p/main.tex" }]);
  });

  it("falls back to biber's stderr lines, then to naming the .blg", async () => {
    expect(await biberProblems(`ERROR - Biber could not run: boom\n${FAILED}`, outDir, "main", "/m.tex")).toEqual([{ severity: "error", message: "Biber: Biber could not run: boom", file: "/m.tex" }]);
    expect(await biberProblems(FAILED, outDir, "main", "/m.tex")).toEqual([{ severity: "error", message: "Biber: see main.blg", file: "/m.tex" }]);
  });

  it("reports nothing when biber did not fail, even with errors left in an old .blg", async () => {
    fs.writeFileSync(path.join(outDir, "main.blg"), "ERROR - stale\n");
    expect(await biberProblems("Latexmk: All targets are up-to-date", outDir, "main", "/m.tex")).toEqual([]);
  });
});
