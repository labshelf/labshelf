// Tests the engine probe: Typst always, Tectonic by platform, TeX Live engines only with latexmk.
import { findExecutable } from "@labshelf/core/node";
import { detectEngines } from "../../../../src/writing/templates/node/engineAvailability";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), findExecutable: jest.fn() }));

const find = findExecutable as jest.Mock;

function installed(...names: string[]): void {
  find.mockImplementation(async (name: string) => (names.includes(name) ? `/usr/bin/${name}` : undefined));
}

describe("detectEngines", () => {
  it("reports the TeX Live engines found next to latexmk", async () => {
    installed("latexmk", "pdflatex", "xelatex");
    const { engines } = await detectEngines();
    expect(engines.has("pdflatex")).toBe(true);
    expect(engines.has("xelatex")).toBe(true);
    expect(engines.has("lualatex")).toBe(false);
    expect(engines.has("typst")).toBe(true);
  });

  it("reports no TeX Live engine without latexmk", async () => {
    installed("pdflatex", "lualatex", "xelatex");
    const { engines } = await detectEngines();
    expect([...engines].filter((engine) => engine.endsWith("latex"))).toEqual([]);
    expect(engines.has("typst")).toBe(true);
  });
});
