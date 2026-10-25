/** Verifies the missing, stale and fresh decision of a figure. */
import { deriveFigureBuildState } from "../../../src/writing/figures/index";

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
