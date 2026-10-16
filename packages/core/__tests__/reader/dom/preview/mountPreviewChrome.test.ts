/**
 * @jest-environment jsdom
 */
// Tests the preview chrome composition: the header's place in the shell and its Recompile state from the build.
import { mountPreviewChrome } from "../../../../src/reader/dom/preview/index";

function setup() {
  document.documentElement.className = "";
  document.body.innerHTML =
    `<main id="pdf-shell"><div id="viewerContainer"></div><div id="status-pill"></div><div id="build-banner" hidden></div></main>`;
  const post = jest.fn();
  const logs = { open: jest.fn(), setRoots: jest.fn() };
  const find = {
    isOpen: false, show: jest.fn(), close: jest.fn(), onToggle: jest.fn(),
  };
  const sidebar = { isOpen: false, toggle: jest.fn(), onChange: jest.fn() };
  const outline = {
    load: async () => ({ rows: [], pages: [] }), currentPage: () => 1, onPageChange: jest.fn(), jump: jest.fn(),
  };
  const chrome = mountPreviewChrome({ post, logs, find, sidebar, countBodyPages: async () => 1, outline });
  const header = () => document.querySelector<HTMLElement>("header.rd-preview-header")!;
  const recompile = () => header().querySelector<HTMLElement>(".rd-preview-recompile")!;
  return { chrome, post, header, recompile };
}

describe("mountPreviewChrome header", () => {
  it("inserts the header before #viewerContainer inside #pdf-shell", () => {
    const { header } = setup();
    const viewer = document.getElementById("viewerContainer")!;
    expect(header().parentElement).toBe(document.getElementById("pdf-shell"));
    expect(header().nextElementSibling).toBe(viewer);
  });

  it("adds rd-preview to the document root", () => {
    setup();
    expect(document.documentElement.classList.contains("rd-preview")).toBe(true);
  });

  it("moves #status-pill into the header", () => {
    const { header } = setup();
    expect(header().contains(document.getElementById("status-pill"))).toBe(true);
  });

  it("no longer offers the code-to-PDF and PDF-to-code buttons", () => {
    const { header } = setup();
    const names = [...header().querySelectorAll("button")].map((b) => `${b.title} ${b.getAttribute("aria-label")}`);
    expect(names.join("|")).not.toMatch(/Show the cursor in the PDF|Show this place in the source/);
  });

  it("posts recompile from the header button", () => {
    const { recompile, post } = setup();
    recompile().click();
    expect(post).toHaveBeenCalledWith({ command: "recompile" });
  });

  it("sets Recompile to building while a build runs", () => {
    const { chrome, recompile } = setup();
    chrome.applyBuild({ state: "building", errors: 0 });
    expect(recompile().dataset["state"]).toBe("building");
    expect(recompile().getAttribute("aria-busy")).toBe("true");
  });

  it("sets Recompile to stale when the build succeeded on an older source", () => {
    const { chrome, recompile } = setup();
    chrome.applyBuild({ state: "succeeded", errors: 0, stale: true });
    expect(recompile().dataset["state"]).toBe("stale");
    expect(recompile().hasAttribute("aria-busy")).toBe(false);
  });

  it("sets Recompile to current after a fresh successful build", () => {
    const { chrome, recompile } = setup();
    chrome.applyBuild({ state: "building", errors: 0 });
    chrome.applyBuild({ state: "succeeded", errors: 0 });
    expect(recompile().dataset["state"]).toBe("current");
    expect(recompile().hasAttribute("aria-busy")).toBe(false);
  });
});
