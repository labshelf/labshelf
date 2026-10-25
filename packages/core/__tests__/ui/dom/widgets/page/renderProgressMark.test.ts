/** @jest-environment jsdom */
// Tests renderProgressMark: the done/total to Arc tone and progress mapping and its label.
import { renderProgressMark } from "../../../../../src/ui/dom/index.js";

const arc = (m: HTMLElement) => m.querySelector("svg")!.getAttribute("class");

describe("renderProgressMark", () => {
  it("maps counts to tone and progress", () => {
    expect(arc(renderProgressMark(0, 5))).toBe("ls-arc ls-arc-accent");
    expect(arc(renderProgressMark(2, 5))).toContain("ls-arc-accent");
    expect(arc(renderProgressMark(5, 5))).toBe("ls-arc ls-arc-ok");
    expect(arc(renderProgressMark(0, 0))).toContain("accent");
  });
  it("labels with counts unless given a label", () => {
    expect(renderProgressMark(3, 5).getAttribute("aria-label")).toBe("3 of 5 Done");
    expect(renderProgressMark(3, 5, "Custom").getAttribute("aria-label")).toBe("Custom");
  });
});
