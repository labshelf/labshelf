/**
 * @jest-environment jsdom
 */
// Tests the preview footer: breadcrumb with its sections menu, build status precedence, slots and the status clock.
import { mountPreviewFooter } from "../../../../../src/reader/dom/preview/footer/index";
import type { OutlineRow } from "../../../../../src/reader/outlineModel";
import type { PreviewRoot, PreviewRoots } from "../../../../../src/reader/previewProtocol";

function root(path: string, over: Partial<PreviewRoot> = {}): PreviewRoot {
  return { path, failed: false, rawLog: true, sourceLinks: true, problems: [], ...over };
}

function errors(n: number) {
  return Array.from({ length: n }, (_, i) => ({ severity: "error" as const, message: `e${i}` }));
}

function roots(shown: string, focused: string, list: PreviewRoot[]): PreviewRoots {
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
