// Tests the engine probe: Typst always, each LaTeX engine only when the shared TeX resolves it.
import { detectEngines } from "../../../../src/writing/templates/node/engineAvailability";

function texWith(...found: string[]) {
  return { resolve: async (engine: string) => (found.includes(engine) ? { engine, executable: "/tex/latexmk" } : "missing") } as never;
}

describe("detectEngines", () => {
  it("reports the LaTeX engines the TeX resolves", async () => {
    const { engines } = await detectEngines(texWith("pdflatex", "xelatex"));
    expect(engines.has("pdflatex")).toBe(true);
    expect(engines.has("xelatex")).toBe(true);
    expect(engines.has("lualatex")).toBe(false);
    expect(engines.has("typst")).toBe(true);
  });

  it("reports only Typst when no TeX is found", async () => {
    const { engines } = await detectEngines(texWith());
    expect([...engines]).toEqual(["typst"]);
  });
});
