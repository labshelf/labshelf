/**
 * Tests that the list panel paints annotation colours with the core highlight palette, as the reader does.
 */
import { ANNOTATION_COLORS, HIGHLIGHT_COLORS } from "@labshelf/core";
import { listPanelCss } from "../../../src/ui/list/template.css";

describe("listPanelCss highlight colours (B6)", () => {
  it.each(ANNOTATION_COLORS)("defines --hl-%s from the core palette", (name) => {
    expect(listPanelCss()).toContain(`--hl-${name}:${HIGHLIGHT_COLORS[name]};`);
  });
});
