/** Verifies which checklist section an item at a source line belongs to, and which sections cite a key. */
import { deriveCitationSections, createSectionPlacer } from "../../../src/writing/checklist/index";

const main = {
  path: "main.tex",
  format: "latex" as const,
  text: ["% preamble", "\\section{Intro}", "see \\cite{a}", "\\section{Methods}", "use \\cite{a,b}", "again \\cite{a}", "\\input{extra}"].join("\n"),
};
const extra = {
  path: "extra.tex",
  format: "latex" as const,
  text: ["\\section{Extra heading}", "cites \\cite{b}", "and \\cite{c}"].join("\n"),
};
const sources = [main, extra];

describe("createSectionPlacer", () => {
  const place = createSectionPlacer(sources, "main.tex");

  it("places a main-file item under the nearest heading at or above it", () => {
    expect(place("main.tex", 2)).toMatchObject({ title: "Intro", file: "main.tex", line: 1 });
    expect(place("main.tex", 1)).toMatchObject({ title: "Intro" });
    expect(place("main.tex", 5)).toMatchObject({ title: "Methods", line: 3 });
  });

  it("places an item before the first heading under the file's own node", () => {
    const section = place("main.tex", 0);
    expect(section.title).toBe("main.tex");
    expect(section.file).toBe("main.tex");
    expect(section.line).toBeUndefined();
  });

  it("places any item of an included file under that file's node, ignoring its headings", () => {
    for (const line of [0, 1, 2]) {
      const section = place("extra.tex", line);
      expect(section.title).toBe("extra.tex");
      expect(section.file).toBe("extra.tex");
      expect(section.line).toBeUndefined();
    }
  });

  it("gives stable ids, equal within a section and distinct across sections", () => {
    expect(place("main.tex", 2).id).toBe(place("main.tex", 2).id);
    expect(place("main.tex", 2).id).toBe(place("main.tex", 1).id);
    expect(place("main.tex", 2).id).not.toBe(place("main.tex", 4).id);
    expect(place("extra.tex", 0).id).not.toBe(place("main.tex", 0).id);
  });
});

describe("deriveCitationSections", () => {
  const cites = deriveCitationSections(sources, "main.tex");

  it("lists each distinct citing section once, in source order", () => {
    expect(cites.get("a")!.map((s) => s.title)).toEqual(["Intro", "Methods"]);
    expect(cites.get("b")!.map((s) => s.title)).toEqual(["Methods", "extra.tex"]);
    expect(cites.get("c")!.map((s) => s.title)).toEqual(["extra.tex"]);
  });

  it("has no entry for an uncited key", () => {
    expect(cites.get("zzz")).toBeUndefined();
  });

  it("uses the same sections as the placer", () => {
    expect(cites.get("a")![0]).toEqual(createSectionPlacer(sources, "main.tex")("main.tex", 2));
  });
});
