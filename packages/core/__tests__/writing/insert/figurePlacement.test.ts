// Tests the free-name search and the base folder of an inserted image.
import { posixPathOps } from "../../../src/library/mutations/index";
import { freeImageName, imageBaseFolder } from "../../../src/writing/insert/index";

describe("freeImageName", () => {
  it("keeps the name when it is free", async () => {
    expect(await freeImageName(posixPathOps, "/p/images", "fig.png", async () => false)).toBe("/p/images/fig.png");
  });

  it("appends the first free number when the name is taken", async () => {
    const taken = new Set(["/p/images/fig.png", "/p/images/fig-2.png"]);
    expect(await freeImageName(posixPathOps, "/p/images", "fig.png", async (path) => taken.has(path))).toBe("/p/images/fig-3.png");
  });
});

describe("imageBaseFolder", () => {
  it("uses the main file's folder for LaTeX", () => {
    expect(imageBaseFolder("latex", "/p", "paper/main.tex", "/p/paper/sec/a.tex", posixPathOps)).toBe("/p/paper");
  });

  it("uses the document's folder for Typst, or for LaTeX without a main file", () => {
    expect(imageBaseFolder("typst", "/p", "main.typ", "/p/sec/a.typ", posixPathOps)).toBe("/p/sec");
    expect(imageBaseFolder("latex", "/p", undefined, "/p/sec/a.tex", posixPathOps)).toBe("/p/sec");
  });
});
