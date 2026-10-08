import { isExternalChangeNoise } from "../../../src/library/externalChange/index";

describe("isExternalChangeNoise", () => {
  it.each([
    "/lib/papers/p/.metadata.yaml.123-abc.tmp",
    "C:\\lib\\papers\\p\\.metadata.yaml.123-abc.tmp",
    "/lib/papers/.DS_Store",
    "C:\\lib\\papers\\.DS_Store",
    "/lib/papers/p/metadata.yaml~",
    "C:\\lib\\papers\\p\\a~",
    "/lib/papers/p/.metadata.yaml.swp",
    "C:\\lib\\papers\\p\\a.swp",
  ])("treats %s as noise", (path) => {
    expect(isExternalChangeNoise(path)).toBe(true);
  });

  it.each([
    "/lib/papers/p/metadata.yaml",
    "/lib/papers/p/paper.pdf",
    "/lib/.research/papers/p/data.json",
    "C:\\lib\\papers\\p\\.keep",
    "/lib/papers/p/notes.tmp",
  ])("treats %s as a library change", (path) => {
    expect(isExternalChangeNoise(path)).toBe(false);
  });
});
