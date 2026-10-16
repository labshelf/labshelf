/**
 * Tests that arcMark.css paints from the mark tokens and shows the label without moving the mark.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARC_TONES } from "@labshelf/core";

describe("arcMark.css", () => {
  const css = readFileSync(join(__dirname, "../../../src/ui/dom/widgets/arcMark.css"), "utf8");

  it("colours each tone from its token and holds no colour literal", () => {
    for (const tone of ARC_TONES) expect(css).toContain(`.ls-arc-${tone} { color: var(--ls-mark-${tone}); }`);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
  it("takes the label out of flow so the mark never moves", () => {
    expect(css).toMatch(/\.ls-arc-mark-label \{[^}]*position: absolute;[^}]*right: 100%;/);
  });
  it("shows the label on hover and keyboard focus, without motion when reduced", () => {
    expect(css).toContain(".ls-arc-mark:hover .ls-arc-mark-label");
    expect(css).toContain(".ls-arc-mark:focus-visible .ls-arc-mark-label");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.ls-arc-mark-label \{ transition: none; \} \}/);
  });
});
