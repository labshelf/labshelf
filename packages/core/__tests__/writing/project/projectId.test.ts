/** Verifies project ids derived from titles. */
import { deriveProjectIdSlug } from "../../../src/writing/project/index";

describe("deriveProjectIdSlug", () => {
  it("folds accents and lowercases", () => {
    expect(deriveProjectIdSlug("Análise Crítica")).toBe("analise-critica");
  });

  it("turns punctuation runs into single hyphens", () => {
    expect(deriveProjectIdSlug("Deep Nets: a   Survey!!")).toBe("deep-nets-a-survey");
  });

  it("trims leading and trailing hyphens", () => {
    expect(deriveProjectIdSlug("  --Hello--  ")).toBe("hello");
  });

  it("falls back to 'project' without letters or digits", () => {
    expect(deriveProjectIdSlug("***")).toBe("project");
    expect(deriveProjectIdSlug("")).toBe("project");
  });
});
