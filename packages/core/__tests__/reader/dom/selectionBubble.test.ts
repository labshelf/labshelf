/**
 * @jest-environment jsdom
 */
// Checks that the bubble's highlight action sends the selection's page rectangle, and that Comment shows only while the shown root maps to its source.
import { SelectionBubble } from "../../../src/reader/dom/selectionBubble";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";

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
  return { post, bubble, ctx };
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


describe("SelectionBubble header tools", () => {
  it("underlines an existing selection with a persisted style", () => {
    const { post, bubble } = setup();
    bubble.setTool("underline");
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: "createAnnotation", style: "underline", pageNumber: 3 }));
  });

  it("clears the active tool on Escape", () => {
    const { bubble } = setup();
    window.getSelection()?.removeAllRanges();
    bubble.onToolChange = jest.fn();
    bubble.setTool("highlight");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bubble.onToolChange).toHaveBeenLastCalledWith(null);
  });
});


it.each(["highlight", "underline"] as const)("uses the chosen colour for the header %s tool", (tool) => {
  const { post, bubble } = setup();
  bubble.setColor("pink");
  bubble.setTool(tool);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: "createAnnotation", color: "pink", ...(tool === "underline" ? { style: "underline" } : {}) }));
});


it("places an unhighlighted note by clicking the page with Add note active", async () => {
  const { bubble, ctx, post } = setup();
  window.getSelection()?.removeAllRanges();
  ctx.container.append(document.getElementById("viewer")!);
  document.body.append(ctx.container);
  bubble.onPlaceNote = jest.fn();
  bubble.setTool("note");
  document.querySelector(".page")!.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 700, clientY: 400 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(bubble.onPlaceNote).toHaveBeenCalledWith(3, 0.7, 0.4);
  expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ command: "createAnnotation" }));
});
