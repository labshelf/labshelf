/** Verifies per-root build folder names. */
import { rootBuildFolder } from "../../../../src/writing/project/buildRoot/index";

describe("rootBuildFolder", () => {
  it("gives roots with the same basename in different folders distinct names", () => {
    expect(rootBuildFolder("a/main.tex")).toBe("a__main.tex");
    expect(rootBuildFolder("b/main.tex")).toBe("b__main.tex");
  });

  it("keeps the name of a top-level root", () => {
    expect(rootBuildFolder("main.tex")).toBe("main.tex");
  });
});
