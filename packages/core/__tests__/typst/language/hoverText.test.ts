// Tests that a markdown hover becomes plain tooltip text.
import { derivePlainHoverText } from "../../../src/typst/language/hoverText";

describe("derivePlainHoverText", () => {
  it("drops the code fence lines and trims", () => {
    expect(derivePlainHoverText("```typst\nlet x = 1\n```\n\nA value")).toBe("let x = 1\n\n\nA value");
  });

  it("is empty when only fences remain", () => {
    expect(derivePlainHoverText("```\n```")).toBe("");
  });
});
