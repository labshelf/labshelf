/**
 * @jest-environment jsdom
 */
// Tests the build logs view: tab counts, filtering, keyboard, jump messages, raw log, closing and refresh.
import { LogsView } from "../../../../../src/reader/dom/preview/index";
import type { PreviewProblem, PreviewRoot, PreviewRoots } from "../../../../../src/reader/previewProtocol";

const MAIN = "/p/chapters/main.tex";

function root(path: string, problems: PreviewProblem[], over: Partial<PreviewRoot> = {}): PreviewRoot {
  return { path, failed: false, rawLog: true, sourceLinks: true, problems, ...over };
}

function roots(list: PreviewRoot[]): PreviewRoots {
  return { main: MAIN, focused: MAIN, shown: MAIN, roots: list };
}

const mixed: PreviewProblem[] = [
  { severity: "warning", message: "Overfull hbox", hint: "Shorten the line", file: "/p/a.tex", line: 4 },
  { severity: "error", message: "Undefined control sequence", hint: "Check the macro name", file: "/p/b.tex", line: 12 },
  { severity: "info", message: "Package loaded" },
  { severity: "error", message: "Missing $ inserted" },
  { severity: "warning", message: "Citation undefined", file: "/p/c.tex", line: 9 },
];

function setup(list: PreviewRoot[] = [root(MAIN, mixed)]) {
  document.body.innerHTML = "";
  const parent = document.createElement("div");
  document.body.append(parent);
  const post = jest.fn();
  const view = new LogsView({ parent, post });
  view.setRoots(roots(list));
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
    const { view, pane } = setup();
    expect(view.isOpen).toBe(false);
    expect(pane().hidden).toBe(true);
  });

  it("opens and shows the pane with the file name of the root", () => {
    const { view, pane } = setup();
    view.open(MAIN);
    expect(view.isOpen).toBe(true);
    expect(pane().hidden).toBe(false);
    expect(pane().textContent).toContain("main.tex");
    expect(pane().textContent).not.toContain("/p/chapters/");
  });

  it("closes through Back to PDF", () => {
    const { view, pane, byLabel } = setup();
    view.open(MAIN);
    byLabel("Back to PDF")!.click();
    expect(view.isOpen).toBe(false);
    expect(pane().hidden).toBe(true);
  });

  it("closes on Escape", () => {
    const { view, pane } = setup();
    view.open(MAIN);
    pane().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(view.isOpen).toBe(false);
    expect(pane().hidden).toBe(true);
  });

  it("close() hides the pane", () => {
    const { view, pane } = setup();
    view.open(MAIN);
    view.close();
    expect(view.isOpen).toBe(false);
    expect(pane().hidden).toBe(true);
  });
});

describe("LogsView tabs", () => {
  it("labels tabs with counts in a tablist", () => {
    const { view, pane, tabs } = setup();
    view.open(MAIN);
    expect(pane().querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs().map((t) => t.textContent)).toEqual(["All 5", "Errors 2", "Warnings 2", "Info 1"]);
  });

  it("keeps zero-count tabs present", () => {
    const { view, tabs } = setup([root(MAIN, [{ severity: "warning", message: "w" }])]);
    view.open(MAIN);
    expect(tabs().map((t) => t.textContent)).toEqual(["All 1", "Errors 0", "Warnings 1", "Info 0"]);
  });

  it("opens on Errors when there are errors", () => {
    const { view, selected, entryTexts } = setup();
    view.open(MAIN);
    expect(selected()!.textContent).toBe("Errors 2");
    expect(entryTexts()).toHaveLength(2);
  });

  it("opens on All when there are no errors", () => {
    const { view, selected, entryTexts } = setup([root(MAIN, [mixed[0]!, mixed[2]!])]);
    view.open(MAIN);
    expect(selected()!.textContent).toBe("All 2");
    expect(entryTexts()).toHaveLength(2);
  });

  it("filters entries when a tab is clicked", () => {
    const { view, tabs, entryTexts } = setup();
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
    const { view, tabs, selected } = setup();
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
    const { view, entryTexts } = setup();
    view.open(MAIN);
    const first = entryTexts()[0]!;
    expect(first).toContain("Undefined control sequence");
    expect(first).toContain("Check the macro name");
    expect(first).toContain("b.tex:12");
  });

  it("posts openProblem with the index in the full list when an entry is clicked", () => {
    const { view, post, entryButtons } = setup();
    view.open(MAIN);
    entryButtons()[0]!.click();
    expect(post).toHaveBeenCalledWith({ command: "openProblem", root: MAIN, index: 1 });
  });

  it("posts the full-list index for an entry on a filtered tab", () => {
    const { view, post, tabs, entryButtons } = setup();
    view.open(MAIN);
    tabs()[2]!.click();
    entryButtons()[1]!.click();
    expect(post).toHaveBeenCalledWith({ command: "openProblem", root: MAIN, index: 4 });
  });

  it("posts openProblem on Enter", () => {
    const { view, post, entryButtons } = setup();
    view.open(MAIN);
    const btn = entryButtons()[0]!;
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    btn.click();
    expect(post).toHaveBeenCalledWith({ command: "openProblem", root: MAIN, index: 1 });
  });

  it("renders an entry without file as plain text that posts nothing", () => {
    const { view, post, pane, tabs, entryButtons } = setup();
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
    const { view, pane, tabs } = setup([root(MAIN, [{ severity: "warning", message: "w" }])]);
    view.open(MAIN);
    tabs()[1]!.click();
    expect(pane().querySelector(".rd-empty")!.textContent).toBe("No problems");
  });
});

describe("LogsView raw log", () => {
  it("posts openRawLog", () => {
    const { view, post, byLabel } = setup();
    view.open(MAIN);
    byLabel("Open raw log")!.click();
    expect(post).toHaveBeenCalledWith({ command: "openRawLog", root: MAIN });
  });

  it("omits Open raw log when the root has no raw log", () => {
    const { view, byLabel } = setup([root(MAIN, mixed, { rawLog: false })]);
    view.open(MAIN);
    expect(byLabel("Open raw log")).toBeNull();
  });
});

describe("LogsView roots", () => {
  it("refreshes entries in place on setRoots without closing", () => {
    const { view, pane, tabs, entryTexts } = setup();
    view.open(MAIN);
    view.setRoots(roots([root(MAIN, [{ severity: "error", message: "Fresh failure" }, ...mixed])]));
    expect(view.isOpen).toBe(true);
    expect(pane().hidden).toBe(false);
    expect(tabs()[1]!.textContent).toBe("Errors 3");
    expect(entryTexts().join("|")).toContain("Fresh failure");
  });

  it("shows No problems when the root is not among the roots", () => {
    const { view, pane } = setup();
    view.open("/p/other.tex");
    expect(view.isOpen).toBe(true);
    expect(pane().querySelector(".rd-empty")!.textContent).toBe("No problems");
  });
});
