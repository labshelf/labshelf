/**
 * @jest-environment jsdom
 */
// Tests the footer's cites status: its text, the problem stepping with wrap-around and what each step does.
import { mountProblems } from "../../../../../src/reader/dom/preview/footer/index";
import type { PdfProblem, PreviewBuildRoots } from "../../../../../src/reader/previewProtocol";
import { showToast } from "../../../../../src/ui/dom/widgets/showToast";

jest.mock("../../../../../src/ui/dom/widgets/showToast", () => ({ showToast: jest.fn() }));

const area = (page: number) => ({ page, left: 0, top: 0, right: 10, bottom: 10 });
const problem = (message: string, extra: Partial<PdfProblem> = {}): PdfProblem => ({ kind: "undefinedCitation", message, ...extra });

function roots(cites: number | undefined, pdfProblems: PdfProblem[]): PreviewBuildRoots {
  const root = { path: "/p/main.pdf", failed: false, rawLog: false, sourceLinks: true, problems: [], pdfProblems, ...(cites === undefined ? {} : { cites }) };
  const other = { path: "/p/other.pdf", failed: false, rawLog: false, sourceLinks: true, problems: [], pdfProblems: [problem("elsewhere")], cites: 99 };
  return { main: "/p/main.pdf", focused: "/p/main.pdf", shown: "/p/main.pdf", roots: [other, root] };
}

function setup(cites: number | undefined, problems: PdfProblem[]) {
  const slot = document.createElement("span");
  const deps = { marks: { flash: jest.fn() }, scrollTo: jest.fn(), post: jest.fn() };
  const view = mountProblems(slot, deps);
  view.setRoots(roots(cites, problems));
  const text = () => slot.querySelector("[role=status]")?.textContent;
  const button = (label: string) => slot.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return { slot, view, deps, text, button };
}

beforeEach(() => jest.mocked(showToast).mockClear());

describe("cites status text", () => {
  it.each([
    [1, [], "1 cite"],
    [7, [], "7 cites"],
    [0, [], "0 cites"],
    [7, [problem("a")], "7 cites · 1 to fix"],
    [1, [problem("a"), problem("b")], "1 cite · 2 to fix"],
  ])("shows %i cites with %j problems as %s", (cites, problems, expected) => {
    const { text, slot } = setup(cites, problems);
    expect(text()).toBe(expected);
    expect(slot.hidden).toBe(false);
  });

  it("hides the slot when the shown root has no cite count and no problems", () => {
    const { slot } = setup(undefined, []);
    expect(slot.hidden).toBe(true);
  });

  it("offers the arrows only while there are problems", () => {
    const withProblems = setup(3, [problem("a")]);
    expect(withProblems.button("Previous problem")).not.toBeNull();
    expect(withProblems.button("Next problem")).not.toBeNull();
    const without = setup(3, []);
    expect(without.button("Previous problem")).toBeNull();
    expect(without.button("Next problem")).toBeNull();
  });

  it("announces the counts through a live region", () => {
    const { slot } = setup(3, [problem("a")]);
    expect(slot.querySelector("[role=status]")?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("problem stepping", () => {
  const placed = [problem("a", { area: area(1) }), problem("b", { area: area(2) }), problem("c", { area: area(3) })];

  it("scrolls to the first problem and flashes it on next", () => {
    const { view, deps } = setup(3, placed);
    view.step(1);
    expect(deps.scrollTo).toHaveBeenLastCalledWith(area(1));
    expect(deps.marks.flash).toHaveBeenLastCalledWith(0);
  });

  it("wraps forward past the last problem", () => {
    const { view, deps } = setup(3, placed);
    [1, 1, 1, 1].forEach((d) => view.step(d as 1));
    expect(deps.marks.flash.mock.calls.map(([i]) => i)).toEqual([0, 1, 2, 0]);
  });

  it("starts at the last problem on previous and wraps backward", () => {
    const { view, deps } = setup(3, placed);
    [-1, -1, -1, -1].forEach((d) => view.step(d as -1));
    expect(deps.marks.flash.mock.calls.map(([i]) => i)).toEqual([2, 1, 0, 2]);
  });

  it("steps from the arrow buttons", () => {
    const { button, deps } = setup(3, placed);
    button("Next problem")?.click();
    button("Previous problem")?.click();
    expect(deps.marks.flash.mock.calls.map(([i]) => i)).toEqual([0, 2]);
  });

  it("restarts the cycle when the roots change", () => {
    const { view, deps } = setup(3, placed);
    view.step(1);
    view.setRoots(roots(3, placed));
    view.step(1);
    expect(deps.marks.flash.mock.calls.map(([i]) => i)).toEqual([0, 0]);
  });

  it("toasts an unplaced problem and opens its source line", () => {
    const { view, deps } = setup(1, [problem("Undefined citation foo", { file: "intro.tex", line: 57 })]);
    view.step(1);
    expect(showToast).toHaveBeenCalledWith("Undefined citation foo");
    expect(deps.post).toHaveBeenCalledWith({ command: "openSourceLine", file: "intro.tex", line: 57 });
    expect(deps.scrollTo).not.toHaveBeenCalled();
    expect(deps.marks.flash).not.toHaveBeenCalled();
  });

  it("toasts an unplaced problem without a source place and posts nothing", () => {
    const { view, deps } = setup(1, [problem("Overfull box")]);
    view.step(1);
    expect(showToast).toHaveBeenCalledWith("Overfull box");
    expect(deps.post).not.toHaveBeenCalled();
  });

  it("toasts when there are no problems", () => {
    const { view, deps } = setup(2, []);
    view.step(1);
    expect(showToast).toHaveBeenCalledWith("No problems in the PDF");
    expect(deps.scrollTo).not.toHaveBeenCalled();
  });
});
