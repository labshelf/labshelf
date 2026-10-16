// Tests that version names become safe, readable folder names.
import { versionSlug } from "../../../src/writing/versions/index";

describe("versionSlug", () => {
  it.each([
    ["submitted", "submitted"],
    ["Camera-ready", "camera-ready"],
    ["Réponse 2", "reponse-2"],
    ["  Rebuttal   round #2!  ", "rebuttal-round-2"],
    ["../x", "x"],
    ["a/b\\c", "a-b-c"],
  ])("turns %j into %j", (name, slug) => {
    expect(versionSlug(name)).toBe(slug);
  });

  it.each(["", "   ", "---", "../", "论文"])("returns undefined for %j", (name) => {
    expect(versionSlug(name)).toBeUndefined();
  });

  it("caps the slug at 60 characters without a trailing dash", () => {
    const slug = versionSlug(`${"a".repeat(59)} b`);
    expect(slug).toBe("a".repeat(59));
    expect(versionSlug("x".repeat(100))).toHaveLength(60);
  });
});
