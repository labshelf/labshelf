/** Verifies project ids derived from titles. */
import { projectIdSlug } from "../../../src/writing/project/index";

describe("projectIdSlug", () => {
  it("folds accents and lowercases", () => {
    expect(projectIdSlug("Análise Crítica")).toBe("analise-critica");
  });

  it("turns punctuation runs into single hyphens", () => {
    expect(projectIdSlug("Deep Nets: a   Survey!!")).toBe("deep-nets-a-survey");
  });

  it("trims leading and trailing hyphens", () => {
    expect(projectIdSlug("  --Hello--  ")).toBe("hello");
  });

  it("falls back to 'project' without letters or digits", () => {
    expect(projectIdSlug("***")).toBe("project");
    expect(projectIdSlug("")).toBe("project");
  });
});
