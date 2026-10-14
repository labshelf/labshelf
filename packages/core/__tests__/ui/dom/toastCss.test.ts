/**
 * Tests that toast.css takes its bottom offset from a variable each page can set.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("toast.css", () => {
  const css = readFileSync(join(__dirname, "../../../src/ui/dom/widgets/toast.css"), "utf8");

  it("offsets the stack from the bottom by --ls-toast-bottom, defaulting to 34px", () => {
    expect(css).toContain("bottom: var(--ls-toast-bottom, 34px)");
  });
  it("defines its own slide animation so pages without base.css animate", () => {
    expect(css).toContain("@keyframes ls-slide");
  });
});
