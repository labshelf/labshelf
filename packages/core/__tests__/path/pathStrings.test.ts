import { baseName, extensionOf, stemOf } from "../../src/path/index";

describe("path string helpers", () => {
  it("baseName returns the last segment and an empty string after a trailing slash", () => {
    expect(baseName("a/b.tex")).toBe("b.tex");
    expect(baseName("a.b/c")).toBe("c");
    expect(baseName("plain")).toBe("plain");
    expect(baseName("")).toBe("");
    expect(baseName("a/b/")).toBe("");
  });

  it("extensionOf returns the lower-case last extension with its dot, or empty", () => {
    expect(extensionOf("a/b.tex")).toBe(".tex");
    expect(extensionOf("a/B.TeX")).toBe(".tex");
    expect(extensionOf("a.b/c")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("a/.gitignore")).toBe("");
    expect(extensionOf("a.tar.gz")).toBe(".gz");
    expect(extensionOf("a.")).toBe(".");
    expect(extensionOf("noDot")).toBe("");
    expect(extensionOf("")).toBe("");
    expect(extensionOf("a/b.tex/")).toBe("");
  });

  it("stemOf drops the last extension of the base name and keeps a leading dot", () => {
    expect(stemOf("a/b.tex")).toBe("b");
    expect(stemOf("a.b/c")).toBe("c");
    expect(stemOf(".gitignore")).toBe(".gitignore");
    expect(stemOf("a.tar.gz")).toBe("a.tar");
    expect(stemOf("a.")).toBe("a");
    expect(stemOf("noDot")).toBe("noDot");
    expect(stemOf("")).toBe("");
    expect(stemOf("a/b/")).toBe("");
  });
});
