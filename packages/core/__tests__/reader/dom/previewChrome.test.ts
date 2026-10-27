/** @jest-environment jsdom */
// Tests the chrome a build preview adds to the reader: mounting, header, build menu, logs button and checks button.
import { mountPreviewChrome, mountBuildMenu, mountLogsButton, mountPreviewHeader, mountChecksButton } from "../../../src/reader/dom/previewChrome";
import { closeMenu } from "../../../src/ui/dom/index";
import type { BuildOptions, PreviewBuildRoots, PreviewProblem, PreviewBuildRoot } from "../../../src/reader/index";

function setupChrome() {
  document.documentElement.className = "";
  document.body.innerHTML =
    `<main id="pdf-shell"><div id="viewerContainer"></div><div id="status-pill"></div><div id="build-banner" hidden></div></main>`;
  const post = jest.fn();
  const logs = { open: jest.fn(), setRoots: jest.fn() };
  const outline = {
    load: async () => ({ rows: [], pages: [] }), currentPage: () => 1, onPageChange: jest.fn(), jump: jest.fn(),
  };
  const pdfViewer = { pagesCount: 0, getPageView: () => undefined, eventBus: { on: jest.fn() } } as unknown as Parameters<typeof mountPreviewChrome>[0]["pdfViewer"];
  const chrome = mountPreviewChrome({ post, logs, countBodyPages: async () => 1, outline, pdfViewer, scrollTo: jest.fn(), setPagesDark: jest.fn() });
  const header = () => document.querySelector<HTMLElement>("header.rd-preview-header")!;
  const recompile = () => header().querySelector<HTMLElement>(".rd-preview-recompile")!;
  return { chrome, post, header, recompile };
}

describe("mountPreviewChrome header", () => {
  it("inserts the header before #viewerContainer inside #pdf-shell", () => {
    const { header } = setupChrome();
    const viewer = document.getElementById("viewerContainer")!;
    expect(header().parentElement).toBe(document.getElementById("pdf-shell"));
    expect(header().nextElementSibling).toBe(viewer);
  });

  it("adds rd-preview to the document root", () => {
    setupChrome();
    expect(document.documentElement.classList.contains("rd-preview")).toBe(true);
  });

  it("moves #status-pill into the header", () => {
    const { header } = setupChrome();
    expect(header().contains(document.getElementById("status-pill"))).toBe(true);
  });

  it("no longer offers the code-to-PDF and PDF-to-code buttons", () => {
    const { header } = setupChrome();
    const names = [...header().querySelectorAll("button")].map((b) => `${b.title} ${b.getAttribute("aria-label")}`);
    expect(names.join("|")).not.toMatch(/Show the cursor in the PDF|Show this place in the source/);
  });

  it("posts recompile from the header button", () => {
    const { recompile, post } = setupChrome();
    recompile().click();
    expect(post).toHaveBeenCalledWith({ command: "recompile" });
  });

  it("sets Recompile to building while a build runs", () => {
    const { chrome, recompile } = setupChrome();
    chrome.applyBuild({ state: "building", errors: 0 });
    expect(recompile().dataset["state"]).toBe("building");
    expect(recompile().getAttribute("aria-busy")).toBe("true");
  });

  it("sets Recompile to stale when the build succeeded on an older source", () => {
    const { chrome, recompile } = setupChrome();
    chrome.applyBuild({ state: "succeeded", errors: 0, stale: true });
    expect(recompile().dataset["state"]).toBe("stale");
    expect(recompile().hasAttribute("aria-busy")).toBe(false);
  });

  it("sets Recompile to current after a fresh successful build", () => {
    const { chrome, recompile } = setupChrome();
    chrome.applyBuild({ state: "building", errors: 0 });
    chrome.applyBuild({ state: "succeeded", errors: 0 });
    expect(recompile().dataset["state"]).toBe("current");
    expect(recompile().hasAttribute("aria-busy")).toBe(false);
  });
});

const rootsBuildMenu = (options?: BuildOptions): PreviewBuildRoots => ({
  main: "a", focused: "a", shown: "a", roots: [], ...(options && { options }),
});

function setupBuildMenu() {
  const post = jest.fn();
  const slot = document.createElement("span");
  slot.hidden = true;
  document.body.replaceChildren(slot);
  const menu = mountBuildMenu(slot, { post });
  const button = () => slot.querySelector<HTMLButtonElement>("button")!;
  const items = () => [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")];
  const item = (text: string) => items().find((b) => b.textContent?.includes(text))!;
  return { menu, post, slot, button, items, item };
}

describe("mountBuildMenu", () => {
  afterEach(() => { closeMenu(); document.body.replaceChildren(); });

  it("keeps the slot hidden while the roots carry no options", () => {
    const t = setupBuildMenu();
    t.menu.setRoots(rootsBuildMenu());
    expect(t.slot.hidden).toBe(true);
    t.menu.setRoots(rootsBuildMenu({ autoCompile: "save" }));
    expect(t.slot.hidden).toBe(false);
    t.menu.setRoots(rootsBuildMenu());
    expect(t.slot.hidden).toBe(true);
  });

  it("labels the gear button and announces the menu", () => {
    const t = setupBuildMenu();
    expect(t.button().getAttribute("aria-label")).toBe("Build options");
    expect(t.button().getAttribute("aria-haspopup")).toBe("menu");
    expect(t.button().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows only the three compile modes for a Typst root, the current one checked", () => {
    const t = setupBuildMenu();
    t.menu.setRoots(rootsBuildMenu({ autoCompile: "off" }));
    t.button().click();
    expect(t.items().map((b) => b.textContent)).toEqual(["Auto compile", "Compile on save", "Compile manually"]);
    expect(t.items().map((b) => b.getAttribute("role"))).toEqual(Array(3).fill("menuitemradio"));
    expect(t.items().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(document.querySelectorAll(".ls-menu-sep")).toHaveLength(0);
    expect(t.button().getAttribute("aria-expanded")).toBe("true");
  });

  it("lists modes, engines and error handling for a LaTeX root with the current choices checked", () => {
    const t = setupBuildMenu();
    t.menu.setRoots(rootsBuildMenu({ autoCompile: "typing", engine: "xelatex", haltOnError: true }));
    t.button().click();
    expect(document.querySelectorAll(".ls-menu-sep")).toHaveLength(2);
    expect(t.items().map((b) => b.textContent)).toEqual([
      "Auto compile", "Compile on save", "Compile manually",
      "pdfLaTeX", "XeLaTeX", "LuaLaTeX",
      "Stop on first error", "Try to compile despite errors",
    ]);
    expect(t.items().map((b) => b.getAttribute("role"))).toEqual(Array(8).fill("menuitemradio"));
    expect(t.items().map((b) => b.getAttribute("aria-checked"))).toEqual(
      ["true", "false", "false", "false", "true", "false", "true", "false"],
    );
  });

  it("checks no engine and continues despite errors for a LaTeX root without those choices", () => {
    const t = setupBuildMenu();
    t.menu.setRoots(rootsBuildMenu({ autoCompile: "save", engine: null }));
    t.button().click();
    expect(t.items().slice(3).map((b) => b.getAttribute("aria-checked"))).toEqual(
      ["false", "false", "false", "false", "true"],
    );
  });

  it("posts setAutoCompile with the picked mode", () => {
    const t = setupBuildMenu();
    t.menu.setRoots(rootsBuildMenu({ autoCompile: "save" }));
    t.button().click();
    t.item("Auto compile").click();
    expect(t.post).toHaveBeenCalledWith({ command: "setAutoCompile", mode: "typing" });
    expect(document.querySelector(".ls-menu")).toBeNull();
  });

  it("posts setHaltOnError with the picked behaviour", () => {
    const t = setupBuildMenu();
    t.menu.setRoots(rootsBuildMenu({ autoCompile: "save", engine: "pdflatex", haltOnError: false }));
    t.button().click();
    t.item("Stop on first error").click();
    expect(t.post).toHaveBeenCalledWith({ command: "setHaltOnError", on: true });
    t.button().click();
    t.item("Try to compile despite errors").click();
    expect(t.post).toHaveBeenLastCalledWith({ command: "setHaltOnError", on: false });
  });

  it("posts setEngine with the picked engine", () => {
    const t = setupBuildMenu();
    t.menu.setRoots(rootsBuildMenu({ autoCompile: "save", engine: "xelatex" }));
    t.button().click();
    t.item("LuaLaTeX").click();
    expect(t.post).toHaveBeenCalledWith({ command: "setEngine", engine: "lualatex" });
  });

  it("closes on Escape, collapses the button and returns focus to it", () => {
    const t = setupBuildMenu();
    t.menu.setRoots(rootsBuildMenu({ autoCompile: "save" }));
    t.button().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".ls-menu")).toBeNull();
    expect(t.button().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(t.button());
  });
});

const root = (path: string, problems: PreviewProblem[], rawLog = false): PreviewBuildRoot =>
  ({ path, failed: false, rawLog, sourceLinks: true, problems });

const rootsLogsButton = (shown: string, list: PreviewBuildRoot[]): PreviewBuildRoots =>
  ({ main: list[0]!.path, focused: shown, shown, roots: list });

const PROBLEMS: PreviewProblem[] = [
  { severity: "info", message: "Package loaded" },
  { severity: "error", message: "Undefined control sequence", file: "intro.tex", line: 12 },
  { severity: "warning", message: "Overfull hbox" },
];

function setupLogsButton() {
  const post = jest.fn();
  const openLogs = jest.fn();
  const slot = document.createElement("span");
  slot.hidden = true;
  document.body.replaceChildren(slot);
  const logs = mountLogsButton(slot, { post, openLogs });
  const button = () => slot.querySelector<HTMLButtonElement>("button")!;
  const count = () => slot.querySelector<HTMLElement>(".rd-logs-count")!;
  const items = () => [...document.querySelectorAll<HTMLButtonElement>(".rd-menu-item")];
  const item = (text: string) => items().find((b) => b.textContent?.includes(text))!;
  return { logs, post, openLogs, slot, button, count, items, item };
}

describe("mountLogsButton", () => {
  afterEach(() => document.body.replaceChildren());

  it("shows the slot and counts errors and warnings of the shown root, not info", () => {
    const t = setupLogsButton();
    t.logs.setRoots(rootsLogsButton("a.tex", [root("a.tex", PROBLEMS)]));
    expect(t.slot.hidden).toBe(false);
    expect(t.count().textContent).toBe("2");
    expect(t.count().hidden).toBe(false);
    expect(t.button().getAttribute("aria-label")).toBe("Logs, 2 problems");
  });

  it("hides the count at zero problems", () => {
    const t = setupLogsButton();
    t.logs.setRoots(rootsLogsButton("a.tex", [root("a.tex", [PROBLEMS[0]!])]));
    expect(t.count().hidden).toBe(true);
    expect(t.button().getAttribute("aria-label")).toBe("Logs");
  });

  it("follows the shown root", () => {
    const t = setupLogsButton();
    const list = [root("a.tex", PROBLEMS), root("b.tex", [PROBLEMS[1]!])];
    t.logs.setRoots(rootsLogsButton("a.tex", list));
    t.logs.setRoots(rootsLogsButton("b.tex", list));
    expect(t.count().textContent).toBe("1");
    expect(t.button().getAttribute("aria-label")).toBe("Logs, 1 problem");
  });

  it("posts openProblem with the index in the full problem list", () => {
    const t = setupLogsButton();
    t.logs.setRoots(rootsLogsButton("a.tex", [root("a.tex", PROBLEMS)]));
    t.button().click();
    expect(t.items().map((b) => b.textContent)).toEqual([
      "Undefined control sequenceintro.tex:12",
      "Overfull hbox",
      "Show all",
    ]);
    t.item("Overfull").click();
    expect(t.post).toHaveBeenCalledWith({ command: "openProblem", root: "a.tex", index: 2 });
  });

  it("Show all opens the logs of the shown root", () => {
    const t = setupLogsButton();
    t.logs.setRoots(rootsLogsButton("a.tex", [root("a.tex", PROBLEMS)]));
    t.button().click();
    t.item("Show all").click();
    expect(t.openLogs).toHaveBeenCalledWith("a.tex");
  });

  it("offers the raw log only when the root kept one", () => {
    const t = setupLogsButton();
    t.logs.setRoots(rootsLogsButton("a.tex", [root("a.tex", PROBLEMS)]));
    t.button().click();
    expect(t.item("Open raw log")).toBeUndefined();
    t.button().click();
    t.logs.setRoots(rootsLogsButton("a.tex", [root("a.tex", PROBLEMS, true)]));
    t.button().click();
    t.item("Open raw log").click();
    expect(t.post).toHaveBeenCalledWith({ command: "openRawLog", root: "a.tex" });
  });

  it("marks the count with the error tone only when an error exists", () => {
    const t = setupLogsButton();
    t.logs.setRoots(rootsLogsButton("a.tex", [root("a.tex", PROBLEMS)]));
    expect(t.count().dataset["tone"]).toBe("error");
    t.logs.setRoots(rootsLogsButton("a.tex", [root("a.tex", [PROBLEMS[2]!])]));
    expect(t.count().dataset["tone"]).toBe("warning");
  });
});

function setupHeader() {
  const post = jest.fn();
  const pill = document.createElement("div");
  pill.id = "status-pill";
  const setPagesDark = jest.fn();
  const header = mountPreviewHeader({ post, pill, setPagesDark });
  document.body.replaceChildren(header.element);
  const q = <T extends Element = HTMLButtonElement>(sel: string) => header.element.querySelector<T>(sel)!;
  const byName = (name: string) =>
    [...header.element.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name || b.textContent?.trim() === name)!;
  return { header, post, pill, q, byName, setPagesDark };
}

describe("mountPreviewHeader structure", () => {
  it("is a labelled toolbar with the build group before the view group", () => {
    const { header, q } = setupHeader();
    expect(header.element.tagName).toBe("HEADER");
    expect(header.element.classList.contains("rd-preview-header")).toBe(true);
    expect(header.element.getAttribute("role")).toBe("toolbar");
    expect(header.element.getAttribute("aria-label")).toBe("Preview");
    const build = q(".rd-preview-build");
    const view = q(".rd-preview-view");
    expect(build.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(build.parentElement).toBe(header.element);
    expect(view.parentElement).toBe(header.element);
  });

  it("offers three hidden empty slots named options, only and logs in the build group", () => {
    const { header, q } = setupHeader();
    expect(Object.keys(header.slots).sort()).toEqual(["logs", "only", "options"]);
    for (const name of ["options", "only", "logs"] as const) {
      const slot = header.slots[name];
      expect(slot.getAttribute("data-slot")).toBe(name);
      expect(slot.classList.contains("rd-preview-slot")).toBe(true);
      expect(slot.hidden).toBe(true);
      expect(slot.childNodes).toHaveLength(0);
      expect(q(".rd-preview-build").contains(slot)).toBe(true);
    }
  });

  it("orders the build group Recompile then options, only, logs", () => {
    const { q } = setupHeader();
    const order = [...q<HTMLElement>(".rd-preview-build").children].map(
      (c) => c.getAttribute("data-slot") ?? (c.matches(".rd-preview-recompile") ? "recompile" : ""),
    );
    expect(order.filter(Boolean)).toEqual(["recompile", "options", "only", "logs"]);
  });

  it("puts the passed pill element inside the view group", () => {
    const { pill, q } = setupHeader();
    expect(q(".rd-preview-view").contains(pill)).toBe(true);
  });

  it("gives every button an accessible name", () => {
    const { header } = setupHeader();
    const buttons = [...header.element.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) {
      const name = b.getAttribute("aria-label") || b.title || b.textContent?.trim();
      expect(name).toBeTruthy();
    }
  });
});

describe("mountPreviewHeader Recompile", () => {
  it("shows the visible label and posts recompile on click", () => {
    const { q, post } = setupHeader();
    const button = q(".rd-preview-recompile");
    expect(button.textContent).toContain("Recompile");
    button.click();
    expect(post).toHaveBeenCalledWith({ command: "recompile" });
  });

  it("follows setBuild in data-state and sets aria-busy only while building", () => {
    const { header, q } = setupHeader();
    const button = q(".rd-preview-recompile");
    header.setBuild("stale");
    expect(button.dataset["state"]).toBe("stale");
    expect(button.hasAttribute("aria-busy")).toBe(false);
    header.setBuild("building");
    expect(button.dataset["state"]).toBe("building");
    expect(button.getAttribute("aria-busy")).toBe("true");
    header.setBuild("current");
    expect(button.dataset["state"]).toBe("current");
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("stays enabled and clickable while building", () => {
    const { header, q, post } = setupHeader();
    header.setBuild("building");
    const button = q(".rd-preview-recompile");
    expect(button.disabled).toBe(false);
    button.click();
    expect(post).toHaveBeenCalledWith({ command: "recompile" });
  });
});

describe("mountPreviewHeader view group", () => {
  it("posts the project commands from Compare and Mark", () => {
    const { byName, post } = setupHeader();
    byName("Compare").click();
    expect(post).toHaveBeenLastCalledWith({ command: "runCommand", id: "compareVersions" });
    byName("Mark").click();
    expect(post).toHaveBeenLastCalledWith({ command: "runCommand", id: "markVersion" });
  });

  it("toggles Dark PDF locally without a host message", () => {
    const { byName, post, setPagesDark } = setupHeader();
    const dark = byName("Dark PDF");
    expect(dark.getAttribute("aria-pressed")).toBe("false");
    dark.click();
    expect(setPagesDark).toHaveBeenLastCalledWith(true);
    expect(dark.getAttribute("aria-pressed")).toBe("true");
    dark.click();
    expect(setPagesDark).toHaveBeenLastCalledWith(false);
    expect(dark.getAttribute("aria-pressed")).toBe("false");
    expect(post).not.toHaveBeenCalled();
  });

  it("rules the page controls off from Dark PDF", () => {
    const { header, pill } = setupHeader();
    const view = [...header.element.querySelector(".rd-preview-view")!.children];
    const rule = view.findIndex((c) => c.classList.contains("rd-preview-rule"));
    expect(view[rule - 1]?.getAttribute("aria-label")).toBe("Dark PDF");
    expect(view[rule + 1]).toBe(pill);
  });

  it("has no Find or Sidebar button and rules off the logs slot from the only slot", () => {
    const { header, byName } = setupHeader();
    expect(byName("Find")).toBeUndefined();
    expect(byName("Sidebar")).toBeUndefined();
    const build = [...header.element.querySelector(".rd-preview-build")!.children];
    const rule = build.findIndex((c) => c.classList.contains("rd-preview-rule"));
    expect(build[rule - 1]).toBe(header.slots.only);
    expect(build[rule + 1]).toBe(header.slots.logs);
  });
});

function rootsChecks(checks?: number): PreviewBuildRoots {
  const root = { path: "/p/main.tex", failed: false, rawLog: true, sourceLinks: true, problems: [] };
  return { main: "/p/main.tex", focused: "/p/main.tex", shown: "/p/main.tex", roots: [root], ...(checks === undefined ? {} : { checks }) };
}

function setupChecks() {
  document.body.innerHTML = `<span id="slot" hidden></span>`;
  const slot = document.getElementById("slot")!;
  const post = jest.fn();
  const checks = mountChecksButton(slot, { post });
  return { slot, post, checks, button: () => slot.querySelector<HTMLButtonElement>("button") };
}

describe("checks button", () => {
  it("stays hidden before the first check", () => {
    const { slot, checks } = setupChecks();
    checks.setRoots(rootsChecks());
    expect(slot.hidden).toBe(true);
  });

  it("shows the finding count", () => {
    const { slot, checks, button } = setupChecks();
    checks.setRoots(rootsChecks(3));
    expect(slot.hidden).toBe(false);
    expect(button()!.textContent).toBe("3 checks");
    checks.setRoots(rootsChecks(1));
    expect(button()!.textContent).toBe("1 check");
  });

  it("hides again when the count goes away", () => {
    const { slot, checks } = setupChecks();
    checks.setRoots(rootsChecks(2));
    checks.setRoots(rootsChecks());
    expect(slot.hidden).toBe(true);
  });

  it("runs the pre-submission check on click", () => {
    const { post, checks, button } = setupChecks();
    checks.setRoots(rootsChecks(0));
    button()!.click();
    expect(post).toHaveBeenCalledWith({ command: "runCommand", id: "checkBeforeSubmitting" });
  });
});
