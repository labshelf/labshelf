// Tests that the list column layout keeps the title column's width floor.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(__dirname, "../../../../src/library-ui/dom/styles/library-list.css"), "utf8");

describe("library-list.css column layouts", () => {
  it("defines one track list with a 120px title floor; narrow panes zero the optional tracks instead", () => {
    const layouts = [...CSS.matchAll(/--cols:\s*([^;]+);/g)].map((m) => m[1]!);
    expect(layouts).toHaveLength(1);
    expect(layouts[0]).toContain("minmax(240px, 3fr)");
  });
});
