/** @jest-environment jsdom */
// Tests progressMark: the done/total to Arc tone and progress mapping and its label.
import { progressMark } from "../../../../../src/ui/dom/index.js";

const arc = (m: HTMLElement) => m.querySelector("svg")!.getAttribute("class");

describe("progressMark", () => {
  it("maps counts to tone and progress", () => {
    expect(arc(progressMark(0, 5))).toBe("ls-arc ls-arc-accent");
    expect(arc(progressMark(2, 5))).toContain("ls-arc-accent");
    expect(arc(progressMark(5, 5))).toBe("ls-arc ls-arc-ok");
    expect(arc(progressMark(0, 0))).toContain("accent");
  });
  it("labels with counts unless given a label", () => {
    expect(progressMark(3, 5).getAttribute("aria-label")).toBe("3 of 5 Done");
    expect(progressMark(3, 5, "Custom").getAttribute("aria-label")).toBe("Custom");
  });
});
