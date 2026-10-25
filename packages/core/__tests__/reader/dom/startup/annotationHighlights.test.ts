/**
 * @jest-environment jsdom
 */
// Checks that a highlight the host sends is drawn on its page, not only listed in the Annotations tab.
import type { HostToWebview } from "../../../../src/reader/protocol/index";
import { PageHighlights } from "../../../../src/reader/dom/highlights";
import { attachReaderHostMessages, type HostMessageParts } from "../../../../src/reader/dom/startup/hostMessages";

type Handler = (msg: HostToWebview) => void;

function setup() {
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
    const { send, page } = setup();
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
