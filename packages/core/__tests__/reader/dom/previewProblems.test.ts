/** @jest-environment jsdom */
// Tests the problems of a build preview: the limit meter, the problem marks over pages and the build logs.
import { mountLimitMeter, mountProblemMarks, LogsView } from "../../../src/reader/dom/previewProblems";
import type { PreviewBuildRoots, PreviewProblem, PreviewBuildRoot } from "../../../src/reader/protocol/previewProtocol";
import type { PdfProblem } from "../../../src/reader/index";

function rootsMeter(extra: Partial<PreviewBuildRoots> = {}, words?: number): PreviewBuildRoots {
  const root = { path: "/p/main.tex", failed: false, rawLog: true, sourceLinks: true, problems: [], ...(words === undefined ? {} : { words }) };
  return { main: "/p/main.tex", focused: "/p/main.tex", shown: "/p/main.tex", roots: [root], ...extra };
}

function setupMeter(pages = 5) {
  document.body.innerHTML = `<span id="slot" hidden></span>`;
  const slot = document.getElementById("slot")!;
  const post = jest.fn();
  const countBodyPages = jest.fn(async () => pages);
  const meter = mountLimitMeter(slot, { post, countBodyPages });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const button = () => slot.querySelector<HTMLButtonElement>(".rd-limit")!;
  const fill = () => slot.querySelector<HTMLElement>(".rd-limit-meter i")!;
  const posts = (command: string) => post.mock.calls.map(([m]) => m).filter((m) => m.command === command);
  return { slot, post, countBodyPages, meter, flush, button, fill, posts };
}

describe("limit meter", () => {
  it("shows pages against the page limit", async () => {
    const { slot, meter, flush, button } = setupMeter(5);
    meter.setRoots(rootsMeter({ pageLimit: 6 }));
    await flush();
    expect(slot.hidden).toBe(false);
    expect(button().textContent).toContain("5 / 6 pp");
  });

  it.each([
    [8, 10, ""],
    [9, 10, "near"],
    [10, 10, "near"],
    [11, 10, "over"],
  ])("fills the meter at %i of %i with state %p", async (pages, limit, state) => {
    const { meter, flush, fill } = setupMeter(pages);
    meter.setRoots(rootsMeter({ pageLimit: limit }));
    await flush();
    expect(fill().className).toBe(state);
    expect(fill().style.width).toBe(`${Math.min(100, (pages / limit) * 100)}%`);
  });

  it("shows words against the word limit and takes the worse ratio for the meter", async () => {
    const { meter, flush, button, fill } = setupMeter(2);
    meter.setRoots(rootsMeter({ pageLimit: 10, wordLimit: 1000 }, 1200));
    await flush();
    expect(button().textContent).toContain("2 / 10 pp · 1,200 / 1,000 words");
    expect(fill().className).toBe("over");
  });

  it("omits the limit of a half that has none", async () => {
    const { meter, flush, button } = setupMeter(2);
    meter.setRoots(rootsMeter({ wordLimit: 5000 }, 378));
    await flush();
    expect(button().textContent).toBe("2 pp · 378 / 5,000 words");
  });

  it("shows plain counts when no limit is set", async () => {
    const { meter, flush, button } = setupMeter(2);
    meter.setRoots(rootsMeter({}, 1378));
    await flush();
    expect(button().textContent).toBe("2 pp · 1,378 words");
  });

  it("offers the popover with no limits set", () => {
    const { slot, meter, button } = setupMeter();
    meter.setRoots(rootsMeter());
    expect(slot.hidden).toBe(false);
    expect(button().textContent).toBe("Limits");
  });

  it("reports body pages once per PDF and again after a document change", async () => {
    const { meter, flush, posts, countBodyPages } = setupMeter(5);
    meter.setRoots(rootsMeter({ pageLimit: 6 }));
    await flush();
    meter.setRoots(rootsMeter({ pageLimit: 7 }));
    await flush();
    expect(posts("bodyPages")).toEqual([{ command: "bodyPages", root: "/p/main.tex", contentPages: 5 }]);
    meter.documentChanged();
    await flush();
    expect(posts("bodyPages")).toHaveLength(2);
    expect(countBodyPages).toHaveBeenCalledTimes(2);
  });
});

describe("limit popover", () => {
  const open = async (r: PreviewBuildRoots) => {
    const s = setupMeter();
    s.meter.setRoots(r);
    await s.flush();
    s.button().click();
    const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const commit = (el: HTMLInputElement, value: string) => {
      el.value = value;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    };
    return { ...s, input, commit };
  };

  it("posts only the changed field", async () => {
    const { input, commit, posts } = await open(rootsMeter({ pageLimit: 6, wordLimit: 1000 }));
    commit(input("Page limit"), "8");
    expect(posts("setCheckLimits")).toEqual([{ command: "setCheckLimits", limits: { pages: 8 } }]);
  });

  it("posts null when a limit is emptied", async () => {
    const { input, commit, posts } = await open(rootsMeter({ pageLimit: 6 }));
    commit(input("Page limit"), "  ");
    expect(posts("setCheckLimits")).toEqual([{ command: "setCheckLimits", limits: { pages: null } }]);
  });

  it("posts a limit set on blur once, and nothing when unchanged", async () => {
    const { input, posts } = await open(rootsMeter({ wordLimit: 1000 }));
    const words = input("Word limit");
    words.dispatchEvent(new Event("blur"));
    expect(posts("setCheckLimits")).toHaveLength(0);
    words.value = "1500";
    words.dispatchEvent(new Event("blur"));
    words.dispatchEvent(new Event("blur"));
    expect(posts("setCheckLimits")).toEqual([{ command: "setCheckLimits", limits: { words: 1500 } }]);
  });

  it.each(["0", "-3", "1.5", "abc"])("rejects %p and posts nothing", async (value) => {
    const { input, commit, posts } = await open(rootsMeter({ pageLimit: 6 }));
    commit(input("Page limit"), value);
    expect(posts("setCheckLimits")).toHaveLength(0);
    expect(input("Page limit").getAttribute("aria-invalid")).toBe("true");
  });

  it("switches where counting stops with a segmented control", async () => {
    const { posts } = await open(rootsMeter({ pageLimit: 6 }));
    const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([["References", "true"], ["End", "false"]]);
    radios[1]!.click();
    expect(posts("setCheckLimits")).toEqual([{ command: "setCheckLimits", limits: { countUpTo: "end" } }]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    radios[1]!.click();
    expect(posts("setCheckLimits")).toHaveLength(1);
  });

  it("closes on Escape and returns focus to the meter", async () => {
    const { input, button } = await open(rootsMeter({ pageLimit: 6 }));
    input("Page limit").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".rd-popover")).toBeNull();
    expect(document.activeElement).toBe(button());
  });
});

const WIDTH = 600;
const HEIGHT = 800;

function setupMarks() {
  document.body.innerHTML = `<div id="viewer"><div id="p1"></div><div id="p2"></div></div>`;
  const container = document.getElementById("viewer")!;
  const pages = [document.getElementById("p1")!, document.getElementById("p2")!];
  // Scale 1, no rotation: the viewport is the page in points.
  const viewport = {
    width: WIDTH,
    height: HEIGHT,
    viewBox: [0, 0, WIDTH, HEIGHT],
    convertToPdfPoint: (x: number, y: number) => [x, HEIGHT - y],
    convertToViewportPoint: (x: number, y: number) => [x, HEIGHT - y],
  };
  const handlers = new Map<string, (event?: unknown) => void>();
  const pdfViewer = {
    pagesCount: pages.length,
    getPageView: (index: number) => (pages[index] ? { div: pages[index], viewport } : undefined),
    eventBus: { on: (name: string, fn: (event?: unknown) => void) => handlers.set(name, fn) },
  };
  const marks = mountProblemMarks({ container, pdfViewer: pdfViewer as never });
  const marksOf = (index: number) => Array.from(pages[index]!.querySelectorAll<HTMLElement>(".rd-problem-marks > *"));
  return { marks, handlers, pages, marksOf };
}

const area = { page: 1, left: 60, top: 80, right: 300, bottom: 160 };
const problems: PdfProblem[] = [
  { kind: "undefinedCitation", message: "a", area },
  { kind: "preprint", message: "b", area: { ...area, page: 2 } },
  { kind: "overfull", message: "c" },
  { kind: "overfull", message: "d", area },
];

describe("mountProblemMarks", () => {
  it("draws one hidden mark per placed problem on its page and none for unplaced ones", () => {
    const { marks, marksOf, pages } = setupMarks();
    marks.setProblems(problems);
    expect(marksOf(0)).toHaveLength(2);
    expect(marksOf(1)).toHaveLength(1);
    expect(pages[0]!.querySelectorAll(".rd-problem-marks")).toHaveLength(1);
    expect(pages[0]!.querySelector(".rd-problem-marks")!.getAttribute("aria-hidden")).toBe("true");
    const [mark] = marksOf(0);
    expect(mark!.className).toContain("rd-problem-mark--undefinedCitation");
    expect(mark!.getAttribute("aria-hidden")).toBe("true");
    expect(mark!.style.left).toBe("10%");
    expect(mark!.style.top).toBe("10%");
    expect(mark!.style.width).toBe("40%");
    expect(mark!.style.height).toBe("10%");
    const bar = marksOf(0)[1]!;
    expect(bar.className).toContain("rd-problem-mark--overfull");
    expect(bar.style.left).toBe("50%");
    expect(bar.style.width).toBe("");
  });

  it("keeps one set of marks when a page re-renders or the zoom changes", () => {
    const { marks, handlers, marksOf, pages } = setupMarks();
    marks.setProblems(problems);
    handlers.get("pagerendered")!({ pageNumber: 1 });
    handlers.get("scalechanging")!();
    expect(marksOf(0)).toHaveLength(2);
    expect(marksOf(1)).toHaveLength(1);
    expect(pages[0]!.querySelectorAll(".rd-problem-marks")).toHaveLength(1);
  });

  it("redraws marks that pdf.js removed with the page contents", () => {
    const { marks, handlers, marksOf, pages } = setupMarks();
    marks.setProblems(problems);
    pages[0]!.replaceChildren();
    handlers.get("pagerendered")!({ pageNumber: 1 });
    expect(marksOf(0)).toHaveLength(2);
  });

  it("clears the marks when the problems are replaced by an empty list", () => {
    const { marks, marksOf } = setupMarks();
    marks.setProblems(problems);
    marks.setProblems([]);
    expect(marksOf(0)).toHaveLength(0);
    expect(marksOf(1)).toHaveLength(0);
  });

  it("flashes the mark of a problem index for a short time, and ignores unplaced or unknown indexes", () => {
    jest.useFakeTimers();
    const { marks, marksOf } = setupMarks();
    marks.setProblems(problems);
    marks.flash(2);
    marks.flash(9);
    expect(document.querySelectorAll(".rd-problem-mark--flash")).toHaveLength(0);
    marks.flash(3);
    expect(marksOf(0)[1]!.classList.contains("rd-problem-mark--flash")).toBe(true);
    jest.runAllTimers();
    expect(document.querySelectorAll(".rd-problem-mark--flash")).toHaveLength(0);
    jest.useRealTimers();
  });
});

const MAIN = "/p/chapters/main.tex";

function root(path: string, problems: PreviewProblem[], over: Partial<PreviewBuildRoot> = {}): PreviewBuildRoot {
  return { path, failed: false, rawLog: true, sourceLinks: true, problems, ...over };
}

function rootsLogs(list: PreviewBuildRoot[]): PreviewBuildRoots {
  return { main: MAIN, focused: MAIN, shown: MAIN, roots: list };
}

const mixed: PreviewProblem[] = [
  { severity: "warning", message: "Overfull hbox", hint: "Shorten the line", file: "/p/a.tex", line: 4 },
  { severity: "error", message: "Undefined control sequence", hint: "Check the macro name", file: "/p/b.tex", line: 12 },
  { severity: "info", message: "Package loaded" },
  { severity: "error", message: "Missing $ inserted" },
  { severity: "warning", message: "Citation undefined", file: "/p/c.tex", line: 9 },
];

function setupLogs(list: PreviewBuildRoot[] = [root(MAIN, mixed)]) {
  document.body.innerHTML = "";
  const parent = document.createElement("div");
  document.body.append(parent);
  const post = jest.fn();
  const view = new LogsView({ parent, post });
  view.setRoots(rootsLogs(list));
  const pane = () => parent.querySelector<HTMLElement>('[role="region"][aria-label="Build logs"]')!;
  const tabs = () => [...pane().querySelectorAll<HTMLElement>('[role="tab"]')];
  const selected = () => tabs().find((t) => t.getAttribute("aria-selected") === "true");
  const entryTexts = () => [...pane().querySelectorAll("li")].map((li) => li.textContent ?? "");
  const entryButtons = () => [...pane().querySelectorAll<HTMLButtonElement>("li button")];
  const byLabel = (label: string) =>
    pane().querySelector<HTMLElement>(`[title="${label}"], [aria-label="${label}"]`);
  return { view, parent, post, pane, tabs, selected, entryTexts, entryButtons, byLabel };
}

describe("LogsView visibility", () => {
  it("is hidden until opened", () => {
    const { view, pane } = setupLogs();
    expect(view.isOpen).toBe(false);
    expect(pane().hidden).toBe(true);
  });

  it("opens and shows the pane with the file name of the root", () => {
    const { view, pane } = setupLogs();
    view.open(MAIN);
    expect(view.isOpen).toBe(true);
    expect(pane().hidden).toBe(false);
    expect(pane().textContent).toContain("main.tex");
    expect(pane().textContent).not.toContain("/p/chapters/");
  });

  it("closes through Back to PDF", () => {
    const { view, pane, byLabel } = setupLogs();
    view.open(MAIN);
    byLabel("Back to PDF")!.click();
    expect(view.isOpen).toBe(false);
    expect(pane().hidden).toBe(true);
  });

  it("closes on Escape", () => {
    const { view, pane } = setupLogs();
    view.open(MAIN);
    pane().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(view.isOpen).toBe(false);
    expect(pane().hidden).toBe(true);
  });

  it("close() hides the pane", () => {
    const { view, pane } = setupLogs();
    view.open(MAIN);
    view.close();
    expect(view.isOpen).toBe(false);
    expect(pane().hidden).toBe(true);
  });
});

describe("LogsView tabs", () => {
  it("labels tabs with counts in a tablist", () => {
    const { view, pane, tabs } = setupLogs();
    view.open(MAIN);
    expect(pane().querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs().map((t) => t.textContent)).toEqual(["All 5", "Errors 2", "Warnings 2", "Info 1"]);
  });

  it("keeps zero-count tabs present", () => {
    const { view, tabs } = setupLogs([root(MAIN, [{ severity: "warning", message: "w" }])]);
    view.open(MAIN);
    expect(tabs().map((t) => t.textContent)).toEqual(["All 1", "Errors 0", "Warnings 1", "Info 0"]);
  });

  it("opens on Errors when there are errors", () => {
    const { view, selected, entryTexts } = setupLogs();
    view.open(MAIN);
    expect(selected()!.textContent).toBe("Errors 2");
    expect(entryTexts()).toHaveLength(2);
  });

  it("opens on All when there are no errors", () => {
    const { view, selected, entryTexts } = setupLogs([root(MAIN, [mixed[0]!, mixed[2]!])]);
    view.open(MAIN);
    expect(selected()!.textContent).toBe("All 2");
    expect(entryTexts()).toHaveLength(2);
  });

  it("filters entries when a tab is clicked", () => {
    const { view, tabs, entryTexts } = setupLogs();
    view.open(MAIN);
    tabs()[2]!.click();
    expect(tabs()[2]!.getAttribute("aria-selected")).toBe("true");
    expect(entryTexts().join("|")).toContain("Overfull hbox");
    expect(entryTexts().join("|")).toContain("Citation undefined");
    expect(entryTexts().join("|")).not.toContain("Undefined control sequence");
    tabs()[0]!.click();
    expect(entryTexts()).toHaveLength(5);
    tabs()[3]!.click();
    expect(entryTexts()).toHaveLength(1);
    expect(entryTexts()[0]).toContain("Package loaded");
  });

  it("moves selection with ArrowRight and ArrowLeft using roving tabindex", () => {
    const { view, tabs, selected } = setupLogs();
    view.open(MAIN);
    expect(selected()!.textContent).toBe("Errors 2");
    tabs()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(selected()!.textContent).toBe("Warnings 2");
    expect(tabs().map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "-1", "0", "-1"]);
    tabs()[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    tabs()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(selected()!.textContent).toBe("All 5");
    expect(tabs().map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
  });
});

describe("LogsView entries", () => {
  it("shows message, hint and file:line", () => {
    const { view, entryTexts } = setupLogs();
    view.open(MAIN);
    const first = entryTexts()[0]!;
    expect(first).toContain("Undefined control sequence");
    expect(first).toContain("Check the macro name");
    expect(first).toContain("b.tex:12");
  });

  it("posts openProblem with the index in the full list when an entry is clicked", () => {
    const { view, post, entryButtons } = setupLogs();
    view.open(MAIN);
    entryButtons()[0]!.click();
    expect(post).toHaveBeenCalledWith({ command: "openProblem", root: MAIN, index: 1 });
  });

  it("posts the full-list index for an entry on a filtered tab", () => {
    const { view, post, tabs, entryButtons } = setupLogs();
    view.open(MAIN);
    tabs()[2]!.click();
    entryButtons()[1]!.click();
    expect(post).toHaveBeenCalledWith({ command: "openProblem", root: MAIN, index: 4 });
  });

  it("posts openProblem on Enter", () => {
    const { view, post, entryButtons } = setupLogs();
    view.open(MAIN);
    const btn = entryButtons()[0]!;
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    btn.click();
    expect(post).toHaveBeenCalledWith({ command: "openProblem", root: MAIN, index: 1 });
  });

  it("renders an entry without file as plain text that posts nothing", () => {
    const { view, post, pane, tabs, entryButtons } = setupLogs();
    view.open(MAIN);
    expect(entryButtons()).toHaveLength(1);
    expect(pane().querySelectorAll("li")).toHaveLength(2);
    const plain = [...pane().querySelectorAll("li")].find((li) => li.textContent!.includes("Missing $"))!;
    expect(plain.querySelector("button")).toBeNull();
    (plain as HTMLElement).click();
    tabs()[0]!.click();
    expect(post).not.toHaveBeenCalled();
  });

  it("shows No problems in an empty tab", () => {
    const { view, pane, tabs } = setupLogs([root(MAIN, [{ severity: "warning", message: "w" }])]);
    view.open(MAIN);
    tabs()[1]!.click();
    expect(pane().querySelector(".rd-empty")!.textContent).toBe("No problems");
  });
});

describe("LogsView raw log", () => {
  it("posts openRawLog", () => {
    const { view, post, byLabel } = setupLogs();
    view.open(MAIN);
    byLabel("Open raw log")!.click();
    expect(post).toHaveBeenCalledWith({ command: "openRawLog", root: MAIN });
  });

  it("omits Open raw log when the root has no raw log", () => {
    const { view, byLabel } = setupLogs([root(MAIN, mixed, { rawLog: false })]);
    view.open(MAIN);
    expect(byLabel("Open raw log")).toBeNull();
  });
});

describe("LogsView roots", () => {
  it("refreshes entries in place on setRoots without closing", () => {
    const { view, pane, tabs, entryTexts } = setupLogs();
    view.open(MAIN);
    view.setRoots(rootsLogs([root(MAIN, [{ severity: "error", message: "Fresh failure" }, ...mixed])]));
    expect(view.isOpen).toBe(true);
    expect(pane().hidden).toBe(false);
    expect(tabs()[1]!.textContent).toBe("Errors 3");
    expect(entryTexts().join("|")).toContain("Fresh failure");
  });

  it("shows No problems when the root is not among the roots", () => {
    const { view, pane } = setupLogs();
    view.open("/p/other.tex");
    expect(view.isOpen).toBe(true);
    expect(pane().querySelector(".rd-empty")!.textContent).toBe("No problems");
  });
});
