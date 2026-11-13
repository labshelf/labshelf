/** @jest-environment jsdom */
// Tests the reader mounted inside another page: state classes land on the scope and keys typed outside it are not the reader's.
import { mountPreviewChrome } from "../../../src/reader/dom/previewChrome";
import { Keyboard } from "../../../src/reader/dom/navigation";
import { setReaderScope } from "../../../src/reader/dom/scope";

function mountChrome(): void {
  const pdfViewer = { pagesCount: 0, getPageView: () => undefined, eventBus: { on: jest.fn() } } as unknown as Parameters<typeof mountPreviewChrome>[0]["pdfViewer"];
  mountPreviewChrome({
    post: jest.fn(), logs: { open: jest.fn(), setRoots: jest.fn() }, countBodyPages: async () => 1, pdfViewer, scrollTo: jest.fn(), openAppearance: jest.fn(),
    outline: { load: async () => ({ rows: [], pages: [] }), currentPage: () => 1, onPageChange: jest.fn(), jump: jest.fn() },
  });
}

function setupPage(): { scope: HTMLElement; outside: HTMLTextAreaElement; inside: HTMLElement } {
  document.documentElement.className = "";
  document.body.innerHTML = `<textarea id="code-card"></textarea>
    <section id="reader"><main id="pdf-shell"><div id="viewerContainer" tabindex="0"></div><div id="status-pill"></div><div id="build-banner" hidden></div></main></section>`;
  return {
    scope: document.getElementById("reader")!,
    outside: document.getElementById("code-card") as HTMLTextAreaElement,
    inside: document.getElementById("viewerContainer")!,
  };
}

const keydown = (target: EventTarget, key: string): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };

afterEach(() => setReaderScope(undefined));

describe("reader state root", () => {
  it("puts rd-preview on <html> without a scope", () => {
    setupPage();
    setReaderScope(undefined);
    mountChrome();
    expect(document.documentElement.classList.contains("rd-preview")).toBe(true);
  });

  it("puts rd-preview and rd-scope on the scope, not on <html>, with a scope", () => {
    const { scope } = setupPage();
    setReaderScope(scope);
    mountChrome();
    expect(scope.classList.contains("rd-scope")).toBe(true);
    expect(scope.classList.contains("rd-preview")).toBe(true);
    expect(document.documentElement.classList.contains("rd-preview")).toBe(false);
  });
});

describe("scoped keyboard", () => {
  it("runs a shortcut typed inside the scope and ignores one typed outside it or with focus on <body>", () => {
    const { scope, outside, inside } = setupPage();
    setReaderScope(scope);
    const run = jest.fn();
    new Keyboard({ prefs: { vimKeys: true }, boot: { isMac: false, preview: false } } as never, run);

    // gg (first page) is a chord, so a stray g outside would also leave a prefix that an inside g completes.
    keydown(outside, "g");
    keydown(outside, "g");
    keydown(document.body, "g");
    keydown(document.body, "g");
    expect(run).not.toHaveBeenCalled();

    keydown(inside, "g");
    expect(run).not.toHaveBeenCalled();
    keydown(inside, "g");
    expect(run).toHaveBeenCalledWith("firstPage");
  });
});
