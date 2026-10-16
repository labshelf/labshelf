// Tests that every list column layout keeps the title column's width floor.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(__dirname, "../../../../src/library-ui/dom/styles/library-list.css"), "utf8");

describe("library-list.css column layouts", () => {
  it("gives the title column a 120px floor in the base layout and every narrow-pane variant", () => {
    const layouts = [...CSS.matchAll(/--cols:\s*([^;]+);/g)].map((m) => m[1]!);
    expect(layouts).toHaveLength(4);
    for (const cols of layouts) expect(cols).toContain("minmax(120px, 1fr)");
  });
});
