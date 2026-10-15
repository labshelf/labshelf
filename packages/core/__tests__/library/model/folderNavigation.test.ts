import { breadcrumbFor, countPapersUnder, folderLabel, folderPathLabel, parentDir, relativeFolder, baseName } from "@labshelf/core";

describe("folder navigation", () => {
  describe.each([
    ["/", "/lib/papers", "/lib/papers/ML/Vision"],
    ["\\", "C:\\lib\\papers", "C:\\lib\\papers\\ML\\Vision"],
    ["/", "papers", "papers/ML/Vision"],
  ])("with separator %s", (sep, root, deep) => {
    const join = (...parts: string[]): string => parts.join(sep);

    it("builds a root-first breadcrumb", () => {
      expect(breadcrumbFor(root, deep, sep)).toEqual([
        { label: "All Papers", path: root, isRoot: true },
        { label: "ML", path: join(root, "ML"), isRoot: false },
        { label: "Vision", path: deep, isRoot: false },
      ]);
    });

    it("returns only the root for the root itself or a folder outside it", () => {
      expect(breadcrumbFor(root, root, sep)).toHaveLength(1);
      expect(breadcrumbFor(root, join(root + "-other", "x"), sep)).toHaveLength(1);
    });

    it("finds parents, names and labels", () => {
      expect(parentDir(deep, sep)).toBe(join(root, "ML"));
      expect(baseName(deep, sep)).toBe("Vision");
      expect(folderLabel(root, root, sep)).toBe("All Papers");
      expect(folderLabel(root, deep, sep)).toBe("Vision");
    });

    it("counts papers at any depth and not siblings that share a prefix", () => {
      const papers = [join(root, "ML", "a"), join(root, "ML", "Vision", "b"), join(root, "MLX", "c")];
      expect(countPapersUnder(papers, join(root, "ML"), sep)).toBe(2);
      expect(countPapersUnder(papers, root, sep)).toBe(3);
    });

    it("labels a folder by its path inside the library, the root as All Papers", () => {
      expect(folderPathLabel(root, deep, sep)).toBe("ML / Vision");
      expect(folderPathLabel(root, root, sep)).toBe("All Papers");
      expect(folderPathLabel(root, join(root + "-other", "x"), sep)).toBe("All Papers");
    });

    it("names the holder folder relative to the open one, joined with ' / '", () => {
      expect(relativeFolder(join(deep, "p"), root, sep)).toBe("ML / Vision");
      expect(relativeFolder(join(root, "p"), root, sep)).toBe("");
      expect(relativeFolder(join(deep, "p"), deep, sep)).toBe("");
      expect(relativeFolder(join(root + "-other", "p"), root, sep)).toBe("");
    });
  });

  it("treats the empty path as the root", () => {
    expect(folderLabel("papers", "", "/")).toBe("All Papers");
  });

  it("keeps a path without a separator as its own parent", () => {
    expect(parentDir("papers", "/")).toBe("papers");
  });
});
