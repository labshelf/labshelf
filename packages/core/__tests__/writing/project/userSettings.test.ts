/** Verifies the user-owned keys of labshelf.yaml: figures, values and check. */
import { parseProjectFile, updateProjectFile } from "../../../src/writing/project/index";

const base = "id: a\nformat: latex\n";

describe("labshelf.yaml user keys", () => {
  it("reads figure recipes and value files", () => {
    const result = parseProjectFile(`${base}figures:\n  fig/ablation.pdf:\n    run: python plot_ablation.py\n    inputs: [plot_ablation.py, "results/*.json"]\n  fig/arch.pdf:\n    run: make arch\nvalues: [results.json]\n`);
    expect(result.ok && result.settings.figures).toEqual({
      "fig/ablation.pdf": { run: "python plot_ablation.py", inputs: ["plot_ablation.py", "results/*.json"] },
      "fig/arch.pdf": { run: "make arch", inputs: [] },
    });
    expect(result.ok && result.settings.values).toEqual(["results.json"]);
  });

  it("leaves both keys undefined when absent or empty", () => {
    const result = parseProjectFile(`${base}figures:\nvalues:\n`);
    expect(result.ok && result.settings.figures).toBeUndefined();
    expect(result.ok && result.settings.values).toBeUndefined();
  });

  it.each([
    ["figures: [a.pdf]\n", "figures must map figure paths to recipes"],
    ["figures:\n  a.pdf: make\n", "figures.a.pdf must be a mapping"],
    ["figures:\n  a.pdf:\n    inputs: [x]\n", "figures.a.pdf.run must be text"],
    ["figures:\n  a.pdf:\n    run: make\n    inputs: x.py\n", "figures.a.pdf.inputs must be a list of paths"],
    ["values: results.json\n", "values must be a list of JSON file paths"],
    ["values: [1]\n", "values must be a list of JSON file paths"],
    ["check: 9\n", "check must be a mapping"],
    ["check:\n  pages: 8.5\n", "check.pages must be a positive whole number"],
    ["check:\n  pages: 0\n", "check.pages must be a positive whole number"],
    ["check:\n  authors: Jane Doe\n", "check.authors must be a list of names"],
    ["check:\n  anonymous: yes please\n", "check.anonymous must be true or false"],
  ])("rejects %j", (extra, reason) => {
    expect(parseProjectFile(`${base}${extra}`)).toEqual({ ok: false, reason });
  });

  it("keeps both keys through a settings rewrite", () => {
    const text = `${base}figures:\n  a.pdf:\n    run: make # draws a\nvalues:\n  - r.json\n`;
    expect(updateProjectFile(text, { main: "main.tex" })).toBe(`${text}main: main.tex\n`);
  });

  it("reads the check settings, anonymous unless the user says otherwise", () => {
    const result = parseProjectFile(`${base}check:\n  pages: 9\n  authors: [Jane Doe, John Roe]\n`);
    expect(result.ok && result.settings.check).toEqual({ pages: 9, authors: ["Jane Doe", "John Roe"], anonymous: true });
    const cameraReady = parseProjectFile(`${base}check:\n  anonymous: false\n`);
    expect(cameraReady.ok && cameraReady.settings.check).toEqual({ pages: undefined, authors: undefined, anonymous: false });
  });
});
