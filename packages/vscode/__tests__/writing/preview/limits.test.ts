// Tests the check limits: words of a root up to countUpTo, the remembered finding count per project and the limits patch written to labshelf.yaml.
import { CheckCounts, countBuildRootWords, setCheckLimits } from "../../../src/writing/preview/limits";
import { fakeProjects, readyEntry } from "../../support/writingFixtures";

describe("root words", () => {
  type Project = Parameters<typeof countBuildRootWords>[1];
  const FILES: Record<string, string> = {
    "main.tex": "\\begin{document}\none two\n\\input{sections/body}\n\\bibliography{r}\n\\input{appendix}\n\\end{document}",
    "sections/body.tex": "three four five \\include{deep}",
    "deep.tex": "six",
    "appendix.tex": "seven eight",
  };
  const deps = { readerFor: jest.fn(() => ({ read: async (path: string) => FILES[path] })) };

  function latex(check?: { countUpTo: "references" | "end" }): Project {
    return readyEntry("/p/tex", { settings: { id: "tex", format: "latex", ...(check ? { check: { anonymous: true, ...check } } : {}) } as never }) as Project;
  }

  describe("countBuildRootWords", () => {
    it("counts through the include chain up to the references by default", async () => {
      expect(await countBuildRootWords(deps, latex(), "main.tex")).toBe(6);
      expect(deps.readerFor).toHaveBeenCalledWith("/p/tex");
    });

    it("counts through the appendix for countUpTo end", async () => {
      expect(await countBuildRootWords(deps, latex({ countUpTo: "end" }), "main.tex")).toBe(8);
    });

    it("counts a root that is itself an included file", async () => {
      expect(await countBuildRootWords(deps, latex(), "appendix.tex")).toBe(2);
    });

    it("counts a Typst root from its own file only and 0 for a missing root", async () => {
      const typst = readyEntry("/p/ty", { settings: { id: "ty", format: "typst" } as never }) as Project;
      const typstDeps = { readerFor: () => ({ read: async (path: string) => (path === "paper.typ" ? "a b c #bibliography(\"r.bib\") d" : undefined) }) };
      expect(await countBuildRootWords(typstDeps, typst, "paper.typ")).toBe(3);
      expect(await countBuildRootWords(typstDeps, typst, "gone.typ")).toBe(0);
    });
  });
});

describe("CheckCounts", () => {
  it("returns undefined before a check and the last count after", () => {
    const counts = new CheckCounts();
    expect(counts.get("/p/a")).toBeUndefined();
    counts.record("/p/a", 3);
    counts.record("/p/b", 0);
    counts.record("/p/a", 2);
    expect([counts.get("/p/a"), counts.get("/p/b")]).toEqual([2, 0]);
  });

  it("calls listeners with the folder on every record and stops after dispose", () => {
    const counts = new CheckCounts();
    const seen: string[] = [];
    const subscription = counts.onChange((folder) => seen.push(folder));
    counts.record("/p/a", 1);
    subscription.dispose();
    counts.record("/p/b", 1);
    expect(seen).toEqual(["/p/a"]);
  });
});

describe("limits patch", () => {
  const project = readyEntry("/p/tex") as Parameters<typeof setCheckLimits>[1];

  describe("setCheckLimits", () => {
    it("patches only the fields in the change and reloads the projects", async () => {
      const projects = fakeProjects();
      await setCheckLimits(projects, project, { pages: 8, countUpTo: "end" });
      const patch = projects.data.updateProjectSettings.mock.calls[0]![1];
      expect(projects.data.updateProjectSettings.mock.calls[0]![0]).toBe("/p/tex");
      expect(patch).toEqual({ check: { pages: 8, countUpTo: "end" } });
      expect(Object.keys(patch.check)).toEqual(["pages", "countUpTo"]);
      expect(projects.reload).toHaveBeenCalledTimes(1);
    });

    it("turns null into a removal", async () => {
      const projects = fakeProjects();
      await setCheckLimits(projects, project, { words: null });
      const patch = projects.data.updateProjectSettings.mock.calls[0]![1];
      expect(Object.keys(patch.check)).toEqual(["words"]);
      expect(patch.check.words).toBeUndefined();
    });
  });
});
