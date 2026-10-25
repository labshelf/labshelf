// Tests the free-name search and the base folder of an inserted image.
import { posixPathOps } from "../../../src/library/mutations/index";
import { findFreeImageName, deriveImageBaseFolder } from "../../../src/writing/snippet/index";

describe("findFreeImageName", () => {
  it("keeps the name when it is free", async () => {
    expect(await findFreeImageName(posixPathOps, "/p/images", "fig.png", async () => false)).toBe("/p/images/fig.png");
  });

  it("appends the first free number when the name is taken", async () => {
    const taken = new Set(["/p/images/fig.png", "/p/images/fig-2.png"]);
    expect(await findFreeImageName(posixPathOps, "/p/images", "fig.png", async (path) => taken.has(path))).toBe("/p/images/fig-3.png");
  });
});

describe("deriveImageBaseFolder", () => {
  it("uses the main file's folder for LaTeX", () => {
    expect(deriveImageBaseFolder("latex", "/p", "paper/main.tex", "/p/paper/sec/a.tex", posixPathOps)).toBe("/p/paper");
  });

  it("uses the document's folder for Typst, or for LaTeX without a main file", () => {
    expect(deriveImageBaseFolder("typst", "/p", "main.typ", "/p/sec/a.typ", posixPathOps)).toBe("/p/sec");
    expect(deriveImageBaseFolder("latex", "/p", undefined, "/p/sec/a.tex", posixPathOps)).toBe("/p/sec");
  });
});
