/** @jest-environment jsdom */
// Tests the build preview footer: build state, limits and the citation problems list.
import { mountPreviewFooter, mountProblems } from "../../../src/reader/dom/previewFooter";
import type { OutlineRow } from "../../../src/reader/outline";
import type { PreviewBuildRoot, PreviewBuildRoots, PdfProblem } from "../../../src/reader/protocol/previewProtocol";
import { showToast } from "../../../src/ui/dom/widgets/toast";

function root(path: string, over: Partial<PreviewBuildRoot> = {}): PreviewBuildRoot {
  return { path, failed: false, rawLog: true, sourceLinks: true, problems: [], ...over };
}

function errors(n: number) {
  return Array.from({ length: n }, (_, i) => ({ severity: "error" as const, message: `e${i}` }));
}

function roots(shown: string, focused: string, list: PreviewBuildRoot[]): PreviewBuildRoots {
  return { main: "/p/main.tex", focused, shown, roots: list };
}

function row(id: number, parentId: number | null, depth: number, title: string): OutlineRow {
  return { id, parentId, depth, title, dest: null, url: null, hasChildren: false, bold: false };
}

const outlineRows = [row(0, null, 0, "Intro"), row(1, 0, 1, "Background"), row(2, null, 0, "Methods")];
const outlinePages = [1, 2, 4];
const main = root("/p/main.tex");
const flush = async () => { for (let i = 0; i < 5; i++) { await Promise.resolve(); } };

function setup(withOutline = true, pages = outlinePages) {
  document.body.innerHTML = "";
  let page = 1;
  let clock = 1_000_000_000_000;
  let pageListener: () => void = () => {};
  const openLogs = jest.fn();
  const jump = jest.fn();
  const outline = {
    load: jest.fn(async () => (withOutline ? { rows: outlineRows, pages } : { rows: [], pages: [] })),
    currentPage: () => page,
    onPageChange: (fn: () => void) => { pageListener = fn; },
    jump,
  };
  const footer = mountPreviewFooter({ openLogs, outline, now: () => clock });
  document.body.append(footer.element);
  const crumbs = () => footer.element.querySelector<HTMLElement>(".rd-preview-crumbs")!;
  const status = () => footer.element.querySelector<HTMLElement>(".rd-preview-status")!;
  const statusButton = () => status().querySelector<HTMLButtonElement>("button");
  const goTo = (p: number) => { page = p; pageListener(); };
  const advance = (ms: number) => { clock += ms; };
  const menuItems = () => [...document.querySelectorAll<HTMLElement>(".rd-menu-item")];
  return { footer, openLogs, jump, outline, crumbs, status, statusButton, goTo, advance, menuItems, clock: () => clock };
}

describe("mountPreviewFooter structure", () => {
  it("renders cites, limit and checks as hidden empty slots", () => {
    const { footer } = setup();
    for (const name of ["cites", "limit", "checks"] as const) {
      const slot = footer.slots[name];
      expect(footer.element.contains(slot)).toBe(true);
      expect(slot.dataset["slot"]).toBe(name);
      expect(slot.hidden).toBe(true);
      expect(slot.childElementCount).toBe(0);
    }
  });

  it("is a footer with a polite status region and a labelled breadcrumb nav", () => {
    const { footer, status, crumbs } = setup();
    expect(footer.element.tagName).toBe("FOOTER");
    expect(footer.element.classList.contains("rd-preview-footer")).toBe(true);
    expect(status().getAttribute("role")).toBe("status");
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(crumbs().tagName).toBe("NAV");
    expect(crumbs().getAttribute("aria-label")).toBe("Document position");
  });
});

describe("mountPreviewFooter breadcrumb", () => {
  it("shows the shown root's file name, then section and subsection once the outline loads", async () => {
    const { footer, crumbs, goTo } = setup();
    footer.setRoots(roots("/p/chapters/intro.tex", "/p/chapters/intro.tex", [root("/p/chapters/intro.tex")]));
    await flush();
    expect(crumbs().textContent).toContain("intro.pdf");
    expect(crumbs().textContent).toContain("Intro");
    goTo(2);
    expect(crumbs().textContent).toContain("Intro");
    expect(crumbs().textContent).toContain("Background");
  });

  it("follows the page: a new section replaces the previous trail", async () => {
    const { footer, crumbs, goTo } = setup();
    footer.setRoots(roots(main.path, main.path, [main]));
    await flush();
    goTo(5);
    expect(crumbs().textContent).toContain("Methods");
    expect(crumbs().textContent).not.toContain("Background");
  });

  it("shows only the file name before the first entry", async () => {
    const { footer, crumbs, goTo } = setup(true, [3, 4, 5]);
    footer.setRoots(roots(main.path, main.path, [main]));
    await flush();
    goTo(1);
    expect(crumbs().textContent).toContain("main.pdf");
    for (const title of ["Intro", "Background", "Methods"]) { expect(crumbs().textContent).not.toContain(title); }
  });

  it("opens a menu of the outline entries and jumps to the chosen one", async () => {
    const { footer, crumbs, menuItems, jump } = setup();
    footer.setRoots(roots(main.path, main.path, [main]));
    await flush();
    crumbs().querySelector<HTMLButtonElement>("button")!.click();
    expect(menuItems().map((b) => b.textContent)).toEqual(["Intro", "Background", "Methods"]);
    menuItems()[2]!.click();
    expect(jump).toHaveBeenCalledWith(outlineRows[2]);
    expect(document.querySelectorAll(".rd-menu-item")).toHaveLength(0);
  });

  it("shows the file name alone, with no menu button, when the PDF has no outline", async () => {
    const { footer, crumbs } = setup(false);
    footer.setRoots(roots(main.path, main.path, [main]));
    await flush();
    expect(crumbs().textContent).toContain("main.pdf");
    expect(crumbs().querySelector("button")).toBeNull();
  });

  it("reloads the outline when the document changes", async () => {
    const { footer, outline } = setup();
    footer.setRoots(roots(main.path, main.path, [main]));
    await flush();
    const before = outline.load.mock.calls.length;
    footer.documentChanged();
    await flush();
    expect(outline.load.mock.calls.length).toBe(before + 1);
  });
});

describe("mountPreviewFooter status", () => {
  it("says Compiling… while building, even when the shown root failed", () => {
    const { footer, status, statusButton } = setup();
    footer.setRoots(roots(main.path, main.path, [root(main.path, { failed: true, problems: errors(2) })]));
    footer.setBuild({ state: "building", errors: 0 });
    expect(status().textContent).toBe("Compiling…");
    expect(statusButton()).toBeNull();
  });

  it("names the shown root's failure with a plural error count", () => {
    const { footer, status } = setup();
    footer.setRoots(roots(main.path, main.path, [root(main.path, { failed: true, problems: errors(2) })]));
    footer.setBuild({ state: "failed", errors: 2 });
    expect(status().textContent).toBe("Build failed · 2 errors");
  });

  it("uses the singular for one error", () => {
    const { footer, status } = setup();
    footer.setRoots(roots(main.path, main.path, [root(main.path, { failed: true, problems: errors(1) })]));
    footer.setBuild({ state: "failed", errors: 1 });
    expect(status().textContent).toBe("Build failed · 1 error");
  });

  it("names a failed focused root by file name while another root is shown", () => {
    const { footer, status } = setup();
    const chapter = "/p/chapters/chapter.tex";
    const list = (n: number) => [main, root(chapter, { failed: true, problems: errors(n) })];
    footer.setRoots(roots(main.path, chapter, list(1)));
    footer.setBuild({ state: "succeeded", errors: 0 });
    expect(status().textContent).toBe("chapter.tex: 1 error");
    footer.setRoots(roots(main.path, chapter, list(3)));
    expect(status().textContent).toBe("chapter.tex: 3 errors");
  });

  it("opens the logs of the failed root on click", () => {
    const { footer, statusButton, openLogs } = setup();
    const chapter = "/p/chapter.tex";
    footer.setRoots(roots(main.path, chapter, [main, root(chapter, { failed: true, problems: errors(1) })]));
    statusButton()!.click();
    expect(openLogs).toHaveBeenCalledWith(chapter);
    footer.setRoots(roots(main.path, main.path, [root(main.path, { failed: true, problems: errors(2) })]));
    statusButton()!.click();
    expect(openLogs).toHaveBeenLastCalledWith(main.path);
  });

  it("says Source changed when stale and not failed", () => {
    const { footer, status } = setup();
    footer.setRoots(roots(main.path, main.path, [main]));
    footer.setBuild({ state: "succeeded", errors: 0, stale: true, builtAt: 1 });
    expect(status().textContent).toBe("Source changed");
  });

  it("prefers a failure over Source changed", () => {
    const { footer, status } = setup();
    footer.setRoots(roots(main.path, main.path, [root(main.path, { failed: true, problems: errors(2) })]));
    footer.setBuild({ state: "failed", errors: 2, stale: true });
    expect(status().textContent).toBe("Build failed · 2 errors");
  });

  it("says Compiled with the relative time of the build", () => {
    const { footer, status, clock } = setup();
    footer.setRoots(roots(main.path, main.path, [main]));
    footer.setBuild({ state: "succeeded", errors: 0, builtAt: clock() - 5 * 60_000 });
    expect(status().textContent).toBe("Compiled 5 min ago");
  });

  it("is empty when the build is done and nothing is known", () => {
    const { footer, status } = setup();
    footer.setRoots(roots(main.path, main.path, [main]));
    footer.setBuild({ state: "succeeded", errors: 0 });
    expect(status().textContent).toBe("");
  });

  describe("clock", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("refreshes the relative time every 30 seconds", () => {
      const { footer, status, advance, clock } = setup();
      footer.setRoots(roots(main.path, main.path, [main]));
      footer.setBuild({ state: "succeeded", errors: 0, builtAt: clock() - 50_000 });
      expect(status().textContent).toBe("Compiled just now");
      advance(30_000);
      jest.advanceTimersByTime(30_000);
      expect(status().textContent).toBe("Compiled 1 min ago");
    });
  });
});

jest.mock("../../../src/ui/dom/widgets/toast", () => ({ showToast: jest.fn() }));

const area = (page: number) => ({ page, left: 0, top: 0, right: 10, bottom: 10 });
const problem = (message: string, extra: Partial<PdfProblem> = {}): PdfProblem => ({ kind: "undefinedCitation", message, ...extra });

function rootsProblems(cites: number | undefined, pdfProblems: PdfProblem[]): PreviewBuildRoots {
  const root = { path: "/p/main.pdf", failed: false, rawLog: false, sourceLinks: true, problems: [], pdfProblems, ...(cites === undefined ? {} : { cites }) };
  const other = { path: "/p/other.pdf", failed: false, rawLog: false, sourceLinks: true, problems: [], pdfProblems: [problem("elsewhere")], cites: 99 };
  return { main: "/p/main.pdf", focused: "/p/main.pdf", shown: "/p/main.pdf", roots: [other, root] };
}

function setupProblems(cites: number | undefined, problems: PdfProblem[]) {
  const slot = document.createElement("span");
  const deps = { marks: { flash: jest.fn() }, scrollTo: jest.fn(), post: jest.fn() };
  const view = mountProblems(slot, deps);
  view.setRoots(rootsProblems(cites, problems));
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
    const { text, slot } = setupProblems(cites, problems);
    expect(text()).toBe(expected);
    expect(slot.hidden).toBe(false);
  });

  it("hides the slot when the shown root has no cite count and no problems", () => {
    const { slot } = setupProblems(undefined, []);
    expect(slot.hidden).toBe(true);
  });

  it("offers the arrows only while there are problems", () => {
    const withProblems = setupProblems(3, [problem("a")]);
    expect(withProblems.button("Previous problem")).not.toBeNull();
    expect(withProblems.button("Next problem")).not.toBeNull();
    const without = setupProblems(3, []);
    expect(without.button("Previous problem")).toBeNull();
    expect(without.button("Next problem")).toBeNull();
  });

  it("announces the counts through a live region", () => {
    const { slot } = setupProblems(3, [problem("a")]);
    expect(slot.querySelector("[role=status]")?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("problem stepping", () => {
  const placed = [problem("a", { area: area(1) }), problem("b", { area: area(2) }), problem("c", { area: area(3) })];

  it("scrolls to the first problem and flashes it on next", () => {
    const { view, deps } = setupProblems(3, placed);
    view.step(1);
    expect(deps.scrollTo).toHaveBeenLastCalledWith(area(1));
    expect(deps.marks.flash).toHaveBeenLastCalledWith(0);
  });

  it("wraps forward past the last problem", () => {
    const { view, deps } = setupProblems(3, placed);
    [1, 1, 1, 1].forEach((d) => view.step(d as 1));
    expect(deps.marks.flash.mock.calls.map(([i]) => i)).toEqual([0, 1, 2, 0]);
  });

  it("starts at the last problem on previous and wraps backward", () => {
    const { view, deps } = setupProblems(3, placed);
    [-1, -1, -1, -1].forEach((d) => view.step(d as -1));
    expect(deps.marks.flash.mock.calls.map(([i]) => i)).toEqual([2, 1, 0, 2]);
  });

  it("steps from the arrow buttons", () => {
    const { button, deps } = setupProblems(3, placed);
    button("Next problem")?.click();
    button("Previous problem")?.click();
    expect(deps.marks.flash.mock.calls.map(([i]) => i)).toEqual([0, 2]);
  });

  it("restarts the cycle when the roots change", () => {
    const { view, deps } = setupProblems(3, placed);
    view.step(1);
    view.setRoots(rootsProblems(3, placed));
    view.step(1);
    expect(deps.marks.flash.mock.calls.map(([i]) => i)).toEqual([0, 0]);
  });

  it("toasts an unplaced problem and opens its source line", () => {
    const { view, deps } = setupProblems(1, [problem("Undefined citation foo", { file: "intro.tex", line: 57 })]);
    view.step(1);
    expect(showToast).toHaveBeenCalledWith("Undefined citation foo");
    expect(deps.post).toHaveBeenCalledWith({ command: "openSourceLine", file: "intro.tex", line: 57 });
    expect(deps.scrollTo).not.toHaveBeenCalled();
    expect(deps.marks.flash).not.toHaveBeenCalled();
  });

  it("toasts an unplaced problem without a source place and posts nothing", () => {
    const { view, deps } = setupProblems(1, [problem("Overfull box")]);
    view.step(1);
    expect(showToast).toHaveBeenCalledWith("Overfull box");
    expect(deps.post).not.toHaveBeenCalled();
  });

  it("toasts when there are no problems", () => {
    const { view, deps } = setupProblems(2, []);
    view.step(1);
    expect(showToast).toHaveBeenCalledWith("No problems in the PDF");
    expect(deps.scrollTo).not.toHaveBeenCalled();
  });
});
