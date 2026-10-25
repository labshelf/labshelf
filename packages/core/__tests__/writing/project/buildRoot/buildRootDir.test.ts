/** Verifies per-root build folder names. */
import { deriveBuildRootFolder } from "../../../../src/writing/project/buildRoot/index";

describe("deriveBuildRootFolder", () => {
  it("gives roots with the same basename in different folders distinct names", () => {
    expect(deriveBuildRootFolder("a/main.tex")).toBe("a__main.tex");
    expect(deriveBuildRootFolder("b/main.tex")).toBe("b__main.tex");
  });

  it("keeps the name of a top-level root", () => {
    expect(deriveBuildRootFolder("main.tex")).toBe("main.tex");
  });
});
