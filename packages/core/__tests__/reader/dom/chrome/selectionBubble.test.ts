/**
 * @jest-environment jsdom
 */
// Checks that the bubble's highlight action sends the selection's page rectangle, and that Comment shows only while the shown root maps to its source.
import { SelectionBubble } from "../../../../src/reader/dom/chrome/selectionBubble";
import type { ReaderContext } from "../../../../src/reader/dom/session";

function setup(commentOn?: () => void) {
  document.body.innerHTML = `<div id="selection-toolbar"></div>
    <div id="viewer"><div class="page" data-page-number="3"><div class="textLayer"><span id="s">Chain-of-thought prompting has several</span></div></div></div>`;
  const post = jest.fn();
  const ctx = { boot: { isMac: true }, host: { post }, container: document.createElement("div"), pdfViewer: { currentPageNumber: 1 } } as unknown as ReaderContext;
  const bubble = new SelectionBubble(ctx, commentOn);
  const text = document.getElementById("s")!.firstChild!;
  const range = document.createRange();
  range.selectNodeContents(text);
  const box = { left: 100, top: 200, right: 600, bottom: 230, width: 500, height: 30, x: 100, y: 200, toJSON: () => ({}) } as DOMRect;
  range.getBoundingClientRect = () => box;
  range.getClientRects = () => [box] as unknown as DOMRectList;
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const page = document.querySelector<HTMLElement>(".page")!;
  Object.defineProperty(page, "clientWidth", { value: 1000 });
  Object.defineProperty(page, "clientHeight", { value: 1000 });
  page.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return { post, bubble };
}

describe("SelectionBubble highlight", () => {
  it("sends the selected rectangle in page coordinates with the highlight", () => {
    const { post } = setup();
    document.querySelector<HTMLButtonElement>('button[title="Highlight yellow"]')!.click();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      command: "createAnnotation",
      color: "yellow",
      position: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
    }));
  });
});

describe("SelectionBubble comment", () => {
  const commentButton = () => document.querySelector<HTMLButtonElement>('button[title="Comment on the source"]')!;

  it("hides Comment until the shown root maps to its source", () => {
    const { bubble } = setup(jest.fn());
    expect(commentButton().hidden).toBe(true);
    bubble.setCommentable(true);
    expect(commentButton().hidden).toBe(false);
    bubble.setCommentable(false);
    expect(commentButton().hidden).toBe(true);
  });
});
