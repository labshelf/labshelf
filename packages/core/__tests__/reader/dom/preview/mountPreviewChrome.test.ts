/**
 * @jest-environment jsdom
 */
// Tests the preview chrome: toolbar actions, source-link gating, busy state and the build notice priority.
import { mountPreviewChrome } from "../../../../src/reader/dom/preview/index";
import { BuildBanner } from "../../../../src/reader/dom/chrome/buildBanner";
import type { PreviewRoot, PreviewRoots } from "../../../../src/reader/previewProtocol";

const TYPST_TITLE = "Typst does not link source and PDF yet";

function root(path: string, over: Partial<PreviewRoot> = {}): PreviewRoot {
  return { path, failed: false, rawLog: true, sourceLinks: true, problems: [], ...over };
}

function errors(n: number) {
  return Array.from({ length: n }, (_, i) => ({ severity: "error" as const, message: `e${i}` }));
}

function roots(shown: string, focused: string, list: PreviewRoot[]): PreviewRoots {
  return { main: "/p/main.tex", focused, shown, roots: list };
}

function setup() {
  document.body.innerHTML = `<div id="build-banner" hidden></div>`;
  const actions = document.createElement("div");
  actions.hidden = true;
  document.body.append(actions);
  const post = jest.fn();
  const logs = { open: jest.fn(), setRoots: jest.fn() };
  const openLogs = logs.open;
  const banner = new BuildBanner();
  const chrome = mountPreviewChrome({
    actions, banner, post, logs, visiblePoint: () => ({ page: 3, x: 0, y: 0 }), countBodyPages: async () => 1,
  });
  const buttons = () => [...actions.querySelectorAll("button")];
  return { chrome, actions, post, logs, openLogs, buttons, notice: document.getElementById("build-banner")! };
}

const main = root("/p/main.tex");

describe("mountPreviewChrome toolbar", () => {
  it("unhides the slot with Recompile, code to PDF and PDF to code in order", () => {
    const { actions, buttons } = setup();
    expect(actions.hidden).toBe(false);
    expect(buttons().map((b) => b.title)).toEqual([
      "Recompile", "Show the cursor in the PDF", "Show this place in the source",
    ]);
  });

  it("posts recompile, revealCursor and showSource with the visible point", () => {
    const { buttons, post } = setup();
    buttons()[0]!.click();
    expect(post).toHaveBeenLastCalledWith({ command: "recompile" });
    buttons()[1]!.click();
    expect(post).toHaveBeenLastCalledWith({ command: "revealCursor" });
    buttons()[2]!.click();
    const msg = post.mock.calls.at(-1)![0];
    expect(msg.command).toBe("showSource");
    expect(msg.point.page).toBeGreaterThanOrEqual(1);
  });

  it("disables both arrows with the Typst title when the shown root has no source links", () => {
    const { chrome, buttons } = setup();
    chrome.applyRoots(roots(main.path, main.path, [root(main.path, { sourceLinks: false })]));
    const [, toPdf, toCode] = buttons();
    for (const b of [toPdf!, toCode!]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe(TYPST_TITLE);
    }
    expect(buttons()[0]!.disabled).toBe(false);
  });

  it("enables the arrows when the shown root has source links", () => {
    const { chrome, buttons } = setup();
    chrome.applyRoots(roots(main.path, main.path, [root(main.path, { sourceLinks: false })]));
    chrome.applyRoots(roots(main.path, main.path, [main]));
    expect(buttons()[1]!.disabled).toBe(false);
    expect(buttons()[2]!.disabled).toBe(false);
    expect(buttons()[1]!.title).toBe("Show the cursor in the PDF");
  });

  it("shows Recompile busy but clickable while building", () => {
    const { chrome, buttons, post } = setup();
    chrome.applyBuild("building", 0);
    const recompile = buttons()[0]!;
    expect(recompile.getAttribute("aria-busy")).toBe("true");
    expect(recompile.disabled).toBe(false);
    recompile.click();
    expect(post).toHaveBeenCalledWith({ command: "recompile" });
    chrome.applyBuild("succeeded", 0);
    expect(recompile.getAttribute("aria-busy")).not.toBe("true");
  });
});

describe("mountPreviewChrome notice", () => {
  it("shows building first, even when the shown root failed", () => {
    const { chrome, notice } = setup();
    chrome.applyRoots(roots(main.path, main.path, [root(main.path, { failed: true, problems: errors(2) })]));
    chrome.applyBuild("building", 0);
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("Building");
  });

  it("names the shown root's failure with its error count", () => {
    const { chrome, notice } = setup();
    chrome.applyRoots(roots(main.path, main.path, [root(main.path, { failed: true, problems: errors(2) })]));
    chrome.applyBuild("failed", 2);
    expect(notice.querySelector("button")!.textContent).toBe("Build failed: 2 errors");
  });

  it("names a failed focused root by file name, singular and plural, while main is shown", () => {
    const { chrome, notice } = setup();
    const chapter = "/p/chapters/chapter.tex";
    const list = (n: number) => [main, root(chapter, { failed: true, problems: errors(n) })];
    chrome.applyRoots(roots(main.path, chapter, list(1)));
    expect(notice.querySelector("button")!.textContent).toBe("chapter.tex: 1 error");
    chrome.applyRoots(roots(main.path, chapter, list(3)));
    expect(notice.querySelector("button")!.textContent).toBe("chapter.tex: 3 errors");
  });

  it("clears when nothing failed and nothing builds", () => {
    const { chrome, notice } = setup();
    chrome.applyRoots(roots(main.path, main.path, [main]));
    chrome.applyBuild("succeeded", 0);
    expect(notice.hidden).toBe(true);
  });

  it("opens the failed root's logs on click without posting", () => {
    const { chrome, notice, openLogs, post } = setup();
    const chapter = "/p/chapter.tex";
    chrome.applyRoots(roots(main.path, chapter, [main, root(chapter, { failed: true, problems: errors(1) })]));
    notice.querySelector("button")!.click();
    expect(openLogs).toHaveBeenCalledWith(chapter);
    chrome.applyRoots(roots(main.path, main.path, [root(main.path, { failed: true, problems: errors(2) })]));
    notice.querySelector("button")!.click();
    expect(openLogs).toHaveBeenLastCalledWith(main.path);
    expect(post).not.toHaveBeenCalled();
  });

  it("hands the roots to the logs view", () => {
    const { chrome, logs } = setup();
    const next = roots(main.path, main.path, [main]);
    chrome.applyRoots(next);
    expect(logs.setRoots).toHaveBeenCalledWith(next);
  });
});
