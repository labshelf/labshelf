/**
 * @jest-environment jsdom
 */
// Tests that a sash drag ends exactly once however the pointer is lost, so the pane never follows a released mouse.
import { attachSash } from "../../../../src/library-ui/dom";

let root: HTMLElement;
let pane: HTMLElement;
let sash: HTMLElement;
const persist = jest.fn();

const fire = (type: string, init: { clientX?: number; button?: number } = {}): void => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, "pointerId", { value: 1 });
  sash.dispatchEvent(e);
};

beforeEach(() => {
  persist.mockReset();
  root = document.createElement("div");
  pane = document.createElement("div");
  sash = document.createElement("div");
  pane.style.width = "200px";
  root.append(pane, sash);
  document.body.append(root);
  // jsdom has no pointer capture.
  sash.setPointerCapture = jest.fn();
  sash.releasePointerCapture = jest.fn();
  attachSash(sash, {
    root, pane, collapsedClass: "collapsed", limits: { min: 100, max: 500, collapseAt: 50 },
    widthFromPointer: (x) => x, persist,
  });
});
afterEach(() => root.remove());

test("pointer capture is taken on pointerdown and a drag resizes the pane", () => {
  fire("pointerdown", { button: 0 });
  expect(sash.setPointerCapture).toHaveBeenCalledWith(1);
  expect(root.classList.contains("resizing")).toBe(true);
  fire("pointermove", { clientX: 300 });
  expect(pane.style.width).toBe("300px");
});

test.each(["pointerup", "pointercancel", "lostpointercapture"])("%s ends the drag once and later moves are ignored", (type) => {
  fire("pointerdown", { button: 0 });
  fire("pointermove", { clientX: 300 });
  fire(type);
  fire("lostpointercapture");
  expect(root.classList.contains("resizing")).toBe(false);
  expect(sash.classList.contains("dragging")).toBe(false);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(persist).toHaveBeenCalledWith(300, false);
  fire("pointermove", { clientX: 400 });
  expect(pane.style.width).toBe("300px");
});

test("a non-primary button does not start a drag", () => {
  fire("pointerdown", { button: 2 });
  expect(root.classList.contains("resizing")).toBe(false);
  expect(sash.setPointerCapture).not.toHaveBeenCalled();
});
