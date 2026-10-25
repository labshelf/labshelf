import { deriveBreadcrumb, countPapersUnder, formatFolderLabel, formatFolderPathLabel, deriveParentDir, deriveRelativeFolder, deriveBaseName } from "@labshelf/core";

describe("folder navigation", () => {
  describe.each([
    ["/", "/lib/papers", "/lib/papers/ML/Vision"],
    ["\\", "C:\\lib\\papers", "C:\\lib\\papers\\ML\\Vision"],
    ["/", "papers", "papers/ML/Vision"],
  ])("with separator %s", (sep, root, deep) => {
    const join = (...parts: string[]): string => parts.join(sep);

    it("builds a root-first breadcrumb", () => {
      expect(deriveBreadcrumb(root, deep, sep)).toEqual([
        { label: "All papers", path: root, isRoot: true },
        { label: "ML", path: join(root, "ML"), isRoot: false },
        { label: "Vision", path: deep, isRoot: false },
      ]);
    });

    it("returns only the root for the root itself or a folder outside it", () => {
      expect(deriveBreadcrumb(root, root, sep)).toHaveLength(1);
      expect(deriveBreadcrumb(root, join(root + "-other", "x"), sep)).toHaveLength(1);
    });

    it("finds parents, names and labels", () => {
      expect(deriveParentDir(deep, sep)).toBe(join(root, "ML"));
      expect(deriveBaseName(deep, sep)).toBe("Vision");
      expect(formatFolderLabel(root, root, sep)).toBe("All papers");
      expect(formatFolderLabel(root, deep, sep)).toBe("Vision");
    });

    it("counts papers at any depth and not siblings that share a prefix", () => {
      const papers = [join(root, "ML", "a"), join(root, "ML", "Vision", "b"), join(root, "MLX", "c")];
      expect(countPapersUnder(papers, join(root, "ML"), sep)).toBe(2);
      expect(countPapersUnder(papers, root, sep)).toBe(3);
    });

    it("labels a folder by its path inside the library, the root as All papers", () => {
      expect(formatFolderPathLabel(root, deep, sep)).toBe("ML / Vision");
      expect(formatFolderPathLabel(root, root, sep)).toBe("All papers");
      expect(formatFolderPathLabel(root, join(root + "-other", "x"), sep)).toBe("All papers");
    });

    it("names the holder folder relative to the open one, joined with ' / '", () => {
      expect(deriveRelativeFolder(join(deep, "p"), root, sep)).toBe("ML / Vision");
      expect(deriveRelativeFolder(join(root, "p"), root, sep)).toBe("");
      expect(deriveRelativeFolder(join(deep, "p"), deep, sep)).toBe("");
      expect(deriveRelativeFolder(join(root + "-other", "p"), root, sep)).toBe("");
    });
  });

  it("treats the empty path as the root", () => {
    expect(formatFolderLabel("papers", "", "/")).toBe("All papers");
  });

  it("keeps a path without a separator as its own parent", () => {
    expect(deriveParentDir("papers", "/")).toBe("papers");
  });
});
