import * as path from "node:path";

import { posixPathOps, type PathOps } from "../../src/path/index";

describe("posixPathOps", () => {
  it("agrees with node:path's posix flavour on library paths", () => {
    const cases = ["/lib/papers/ML/p1", "/lib/papers", "papers/ML", "papers", "/"];
    for (const target of cases) {
      expect(posixPathOps.dirname(target)).toBe(path.posix.dirname(target));
      expect(posixPathOps.basename(target)).toBe(path.posix.basename(target));
    }
    expect(posixPathOps.basename("/in/My Paper.pdf", ".pdf")).toBe("My Paper");
    expect(posixPathOps.join("/lib/papers", "ML", "p1")).toBe("/lib/papers/ML/p1");
    expect(posixPathOps.join("papers", "", "p1")).toBe("papers/p1");
    expect(posixPathOps.join("/", "p1")).toBe("/p1");
  });

  it("agrees with node:path's posix flavour on extname, isAbsolute, resolve and relative", () => {
    for (const target of ["/a/b.tex", "a/b.tar.gz", "/a/.bashrc", "/a/b.", "/a/b", "..", "/a.b/c"]) {
      expect(posixPathOps.extname(target)).toBe(path.posix.extname(target));
    }
    expect(posixPathOps.isAbsolute("/a")).toBe(true);
    expect(posixPathOps.isAbsolute("a/b")).toBe(false);
    expect(posixPathOps.resolve("/lib", "a", "../b", ".")).toBe("/lib/b");
    expect(posixPathOps.resolve("/lib", "/other", "x")).toBe("/other/x");
    expect(posixPathOps.resolve("/lib", "..", "..", "x")).toBe("/x");
    expect(posixPathOps.resolve("a", "..", "..", "b")).toBe("../b");
    expect(posixPathOps.resolve("")).toBe(".");
    const pairs: Array<[string, string]> = [
      ["/code/repo", "/code/repo/src/main.tex"], ["/code/repo", "/code/repo"], ["/code/repo", "/code/other/x"],
      ["/code/repo/a", "/code/repo"], ["/code/repo", "/code/repo/../x"], ["/", "/a/b"],
    ];
    for (const [from, to] of pairs) {
      expect(posixPathOps.relative(from, to)).toBe(path.posix.relative(from, to));
    }
  });

  it("is a shape node:path satisfies", () => {
    const node: PathOps = path;
    expect(node.sep).toBe(path.sep);
  });
});
