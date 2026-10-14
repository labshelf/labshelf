/**
 * Tests that every icon renders with the shared wrapper and that no two names share a glyph.
 */
import { CODICON_GLYPHS, STROKE_GLYPHS } from "../../src/ui/icons/glyphs";
import { icon, type IconName } from "../../src/ui/icons";

const NAMES = [...Object.keys(STROKE_GLYPHS), ...Object.keys(CODICON_GLYPHS), "logo"] as IconName[];
const STROKE_NAMES = Object.keys(STROKE_GLYPHS) as IconName[];

const inner = (svg: string): string => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

describe("icon", () => {
  it.each(NAMES)("renders %s as an accessible svg without a fixed size", (name) => {
    const svg = icon(name);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    const root = svg.slice(0, svg.indexOf(">"));
    expect(root).not.toMatch(/\swidth=|\sheight=/);
  });

  it.each(NAMES.filter((n) => n !== "logo"))("draws %s with currentColor", (name) => {
    expect(icon(name)).toContain("currentColor");
  });

  it("keeps the brand colour on the logo", () => {
    expect(icon("logo")).not.toContain("currentColor");
  });

  it.each(STROKE_NAMES)("strokes %s at 1.8 on a 24 grid", (name) => {
    const root = icon(name).slice(0, icon(name).indexOf(">"));
    expect(root).toContain('stroke-width="1.8"');
    expect(root).toContain('viewBox="0 0 24 24"');
  });

  it("draws the codicon chevrons filled on a 16 grid", () => {
    for (const name of Object.keys(CODICON_GLYPHS) as IconName[]) {
      expect(icon(name)).toContain('viewBox="0 0 16 16" fill="currentColor"');
    }
  });

  it("gives every name its own drawing", () => {
    const drawings = NAMES.map((name) => inner(icon(name)));
    expect(new Set(drawings).size).toBe(NAMES.length);
  });
});
