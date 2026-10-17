// Tests the include-only toggle: offered only for a focused `\include`d chapter of a LaTeX root, and a target only while on.
import { IncludeOnlyState } from "../../../../src/writing/build/node/includeOnly";
import { readyEntry } from "../../../support/writingFixtures";

const FILES: Record<string, string> = {
  "main.tex": "\\begin{document}\\include{ch/one}\\include{ch/two}\\input{ch/shared}\\end{document}",
  "ch/one.tex": "One", "ch/two.tex": "Two", "ch/shared.tex": "Shared",
  "plain.tex": "\\input{ch/one}",
};

function setup(settings: Record<string, unknown> = {}) {
  const state = new IncludeOnlyState({ readerFor: () => ({ read: async (path) => FILES[path] }) });
  const project = readyEntry("/p/paper", { settings: { id: "paper", format: "latex", ...settings } }) as Parameters<IncludeOnlyState["option"]>[0];
  return { state, project };
}

describe("IncludeOnlyState", () => {
  it("offers the toggle, off by default, for a file the root includes with \\include", async () => {
    const { state, project } = setup();
    expect(await state.option(project, "main.tex", "ch/two.tex")).toEqual({ file: "ch/two.tex", on: false });
    expect(await state.target(project, "main.tex", "ch/two.tex")).toBeUndefined();
  });

  it("gives the \\include path as the target once the folder is on, and drops it when off again", async () => {
    const { state, project } = setup();
    state.set("/p/paper", true);
    expect(await state.option(project, "main.tex", "ch/one.tex")).toEqual({ file: "ch/one.tex", on: true });
    expect(await state.target(project, "main.tex", "ch/one.tex")).toBe("ch/one");
    state.set("/p/paper", false);
    expect(await state.target(project, "main.tex", "ch/one.tex")).toBeUndefined();
  });

  it("offers nothing when the root has no \\include, the file is only \\input or is not part of the root", async () => {
    const { state, project } = setup();
    expect(await state.option(project, "plain.tex", "ch/one.tex")).toBeUndefined();
    expect(await state.option(project, "main.tex", "ch/shared.tex")).toBeUndefined();
    expect(await state.option(project, "main.tex", "other.tex")).toBeUndefined();
  });

  it("offers nothing for Typst and Tectonic projects", async () => {
    expect(await setup({ format: "typst" }).state.option(setup({ format: "typst" }).project, "main.tex", "ch/one.tex")).toBeUndefined();
    const tectonic = setup({ engine: "tectonic" });
    expect(await tectonic.state.option(tectonic.project, "main.tex", "ch/one.tex")).toBeUndefined();
  });
});
