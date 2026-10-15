// Tests that SyncTeX input paths become comparable absolute paths.
import { normalizeInputPath } from "../../../src/writing/synctex/normalizeInputPath";

describe("normalizeInputPath", () => {
  it("drops ./ segments of an absolute path", () => {
    expect(normalizeInputPath("/work/project/./chapters/extra.tex", "/cwd")).toBe("/work/project/chapters/extra.tex");
  });

  it("resolves a relative path against the build folder", () => {
    expect(normalizeInputPath("main.tex", "/work/project")).toBe("/work/project/main.tex");
    expect(normalizeInputPath("./a/../b/c.tex", "/work/project")).toBe("/work/project/b/c.tex");
    expect(normalizeInputPath("../shared/x.tex", "/work/project")).toBe("/work/shared/x.tex");
  });

  it("uses forward slashes and a lowercase drive letter for Windows paths", () => {
    expect(normalizeInputPath("C:\\Users\\me\\paper\\.\\main.tex", "D:/other")).toBe("c:/Users/me/paper/main.tex");
    expect(normalizeInputPath("chapter.tex", "C:\\Users\\me\\paper")).toBe("c:/Users/me/paper/chapter.tex");
  });
});
