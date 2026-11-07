/** Pins that the contracts document the conversation presence field and the online members and typing of a shared Space. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const doc = (name: string) => readFileSync(join(__dirname, "../../../../documents/contracts", name), "utf8");

describe("presence contracts", () => {
  it("B8 collaboration.md documents the conversation field and its validation", () => {
    const text = doc("collaboration.md");
    expect(text).toContain("`conversation`");
    expect(text).toMatch(/starts with `discussions\/` and ends `\.qmd`/);
  });

  it("B8 spaces.md documents online members and typing", () => {
    const text = doc("spaces.md");
    expect(text).toMatch(/online/);
    expect(text).toMatch(/is typing…/);
  });
});
