/**
 * @jest-environment jsdom
 */
// Tests the preview toolbar's page chip: its tone against the page limit and the single bodyPages report per shown PDF.
import { mountPreviewChrome } from "../../../../src/reader/dom/preview/index";
import { BuildBanner } from "../../../../src/reader/dom/chrome/buildBanner";
import type { PreviewRoots } from "../../../../src/reader/previewProtocol";

function roots(shown: string, pageLimit?: number): PreviewRoots {
  const list = [shown].map((path) => ({ path, failed: false, rawLog: true, sourceLinks: true, problems: [] }));
  return { main: "/p/main.tex", focused: shown, shown, roots: list, ...(pageLimit === undefined ? {} : { pageLimit }) };
}

function setup(contentPages: number) {
  document.body.innerHTML = `<div id="build-banner" hidden></div>`;
  const actions = document.createElement("div");
  document.body.append(actions);
  const post = jest.fn();
  const countBodyPages = jest.fn(async () => contentPages);
  const chrome = mountPreviewChrome({
    actions, banner: new BuildBanner(), post, countBodyPages,
    logs: { open: jest.fn(), setRoots: jest.fn() }, visiblePoint: () => ({ page: 1, x: 0, y: 0 }),
  });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const mark = () => actions.querySelector(".ls-arc-mark");
  const bodyPosts = () => post.mock.calls.map(([m]) => m).filter((m) => m.command === "bodyPages");
  return { chrome, actions, post, countBodyPages, flush, mark, bodyPosts };
}

describe("page chip", () => {
  it("is absent without a page limit", async () => {
    const { chrome, mark, flush } = setup(5);
    chrome.applyRoots(roots("/p/main.tex"));
    await flush();
    expect(mark()).toBeNull();
  });

  it.each([
    [5, 6, "ok"],
    [6, 6, "warn"],
    [7, 6, "err"],
  ])("shows %i of %i with the %s tone, after the buttons", async (pages, limit, tone) => {
    const { chrome, actions, mark, flush } = setup(pages);
    chrome.applyRoots(roots("/p/main.tex", limit));
    await flush();
    expect(mark()!.textContent).toContain(`${pages} of ${limit}`);
    expect(mark()!.querySelector(`.ls-arc-${tone}`)).not.toBeNull();
    expect(actions.lastElementChild).toBe(mark());
  });

  it("posts the body pages once per shown root, not after every roots message", async () => {
    const { chrome, countBodyPages, bodyPosts, flush } = setup(4);
    chrome.applyRoots(roots("/p/main.tex", 6));
    await flush();
    chrome.applyRoots(roots("/p/main.tex", 6));
    await flush();
    expect(bodyPosts()).toEqual([{ command: "bodyPages", root: "/p/main.tex", contentPages: 4 }]);
    expect(countBodyPages).toHaveBeenCalledTimes(1);
  });

  it("recounts and posts again when the shown root changes", async () => {
    const { chrome, bodyPosts, flush } = setup(4);
    chrome.applyRoots(roots("/p/main.tex", 6));
    await flush();
    chrome.applyRoots(roots("/p/chapter.tex", 6));
    await flush();
    expect(bodyPosts().map((m) => m.root)).toEqual(["/p/main.tex", "/p/chapter.tex"]);
  });

  it("recounts and posts again when the document changed", async () => {
    const { chrome, bodyPosts, flush } = setup(4);
    chrome.applyRoots(roots("/p/main.tex", 6));
    await flush();
    chrome.documentChanged();
    await flush();
    chrome.applyRoots(roots("/p/main.tex", 6));
    await flush();
    expect(bodyPosts()).toHaveLength(2);
  });
});
