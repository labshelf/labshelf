/** @jest-environment jsdom */
// Checks how the reader applies host messages: changed regions around a reload, preview build state and stored highlights drawn on their page.
import type { HostToWebview } from "../../../../src/reader/protocol/index";
import { attachReaderHostMessages, type HostMessageParts } from "../../../../src/reader/dom/session/readerUi";
import { PageHighlights } from "../../../../src/reader/dom/highlights";

type Handler = (msg: HostToWebview) => void;

function setup(previewChrome: unknown = null) {
  const handlers = new Map<string, Handler>();
  const order: string[] = [];
  const changeMarks = { show: jest.fn((areas: unknown[]) => order.push(`show:${areas.length}`)) };
  const reloader = { reload: jest.fn(() => { order.push("reload"); return Promise.resolve(); }) };
  const targets = {
    ctx: { host: { on: (type: string, handler: Handler) => handlers.set(type, handler) } },
    ui: { buildBanner: { showReloadError: jest.fn() }, previewChrome },
    reloader,
    changeMarks,
  } as unknown as HostMessageParts;
  attachReaderHostMessages(targets);
  const send = (msg: HostToWebview) => handlers.get(msg.type)!(msg);
  return { send, changeMarks, order };
}

describe("attachReaderHostMessages", () => {
  it("shows the regions a host marks as changed", () => {
    const { send, changeMarks } = setup();
    const areas = [{ page: 2, left: 1, top: 2, right: 3, bottom: 4 }];
    send({ type: "showChanges", areas });
    expect(changeMarks.show).toHaveBeenCalledWith(areas);
  });

  it("clears the marks before a reload, so marks sent after the request stay on the reloaded document", () => {
    const { send, order } = setup();
    send({ type: "showChanges", areas: [{ page: 1, left: 0, top: 0, right: 1, bottom: 1 }] });
    send({ type: "reloadDocument" });
    send({ type: "showChanges", areas: [{ page: 1, left: 0, top: 0, right: 1, bottom: 1 }] });
    expect(order).toEqual(["show:1", "show:0", "reload", "show:1"]);
  });

  it("gives build state and roots to the preview chrome", () => {
    const chrome = { applyBuild: jest.fn(), applyRoots: jest.fn() };
    const { send } = setup(chrome);
    const roots = { main: "/m", focused: "/m", shown: "/m", roots: [] };
    send({ type: "buildStatus", state: "failed", errors: 2 });
    send({ type: "previewRoots", roots });
    expect(chrome.applyBuild).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", errors: 2 }));
    expect(chrome.applyRoots).toHaveBeenCalledWith(roots);
  });

  it("ignores build state and roots outside a preview", () => {
    const { send } = setup();
    expect(() => {
      send({ type: "buildStatus", state: "building", errors: 0 });
      send({ type: "previewRoots", roots: { main: "/m", focused: "/m", shown: "/m", roots: [] } });
    }).not.toThrow();
  });
});

function setupHighlights() {
  document.body.innerHTML = `<div id="viewer"><div class="page" data-page-number="3"><div class="textLayer"><span>Chain-of-thought</span></div></div></div>`;
  const handlers = new Map<string, Handler>();
  const targets = {
    ctx: { host: { on: (type: string, handler: Handler) => handlers.set(type, handler) } },
    ui: { annotationsTab: { setAnnotations: jest.fn() }, highlights: new PageHighlights({ eventBus: { on: jest.fn() } } as never) },
  } as unknown as HostMessageParts;
  attachReaderHostMessages(targets);
  return { send: (msg: HostToWebview) => handlers.get(msg.type)!(msg), page: document.querySelector<HTMLElement>("#viewer .page")! };
}

describe("attachReaderHostMessages updateAnnotations", () => {
  it("draws a stored highlight on its page", () => {
    const { send, page } = setupHighlights();
    const before = page.outerHTML;
    send({
      type: "updateAnnotations",
      annotations: [{
        id: "a1", paperId: "wei2022chainofthought", type: "highlight", pageNumber: 3, content: "Chain-of-thought prompting has several",
        color: "yellow", position: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 }, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z",
      }],
    });
    expect(page.outerHTML).not.toBe(before);
    const mark = page.querySelector<HTMLElement>(".rd-hl-layer .rd-hl.rd-color-yellow");
    expect(mark?.style.left).toBe("10%");
    expect(mark?.style.width).toBe("50%");
  });
});
