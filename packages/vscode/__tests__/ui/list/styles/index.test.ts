/**
 * Tests that the list stylesheet takes every colour from the design tokens, never from VS Code variables directly.
 */
import { ANNOTATION_COLORS } from "@labshelf/core";
import { listPanelCss } from "../../../../src/ui/list/styles";

describe("listPanelCss", () => {
  const css = listPanelCss();

  it.each(ANNOTATION_COLORS)("paints the %s annotation with the core highlight token", (name) => {
    expect(css).toContain(`background:var(--ls-hl-${name})`);
  });

  it("uses no VS Code variable and no local highlight alias", () => {
    expect(css).not.toContain("--vscode-");
    expect(css).not.toContain("--hl-");
  });
});
