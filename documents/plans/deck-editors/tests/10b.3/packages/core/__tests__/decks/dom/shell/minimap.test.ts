/** @jest-environment jsdom */
// Spec 10b.3: the poster minimap, the zoom-to-fit-a-rect maths, the zoom bar's "Zoom to section" button and the Z key.
// The minimap is driven through its port and read back from the DOM it builds; jsdom has no layout, so the page's bounding rect is faked.
import { closeMenu, renderIcon } from "../../../../src/ui/dom/index.js";
import { bindShellKeys, createMinimap, createZoomBar, type ShellKeyActions, type ShellZoomSurface } from "../../../../src/decks/dom/shell/index.js";
import { fitRectZoom } from "../../../../src/decks/dom/shell/minimap.js";

afterEach(() => {
  closeMenu();
  document.body.replaceChildren();
});

type Rect = { left: number; top: number; width: number; height: number };

describe("10b.3a minimap", () => {
  interface Port {
    pageValue: { width: number; height: number } | null;
    boxesValue: Rect[];
    viewportValue: Rect | null;
    panTo: jest.Mock;
  }
  const portOf = (init: Partial<Port> = {}) => {
    const state: Port = {
      pageValue: { width: 1600, height: 2400 },
      boxesValue: [],
      viewportValue: { left: 0, top: 0, width: 800, height: 1200 },
      panTo: jest.fn(),
      ...init,
    };
    const port = {
      page: () => state.pageValue,
      boxes: () => state.boxesValue,
      viewport: () => state.viewportValue,
      panTo: (centre: { x: number; y: number }) => state.panTo(centre),
    };
    return { state, port };
  };
  const mount = (init: Partial<Port> = {}) => {
    const { state, port } = portOf(init);
    const minimap = createMinimap(port);
    document.body.append(minimap.element);
    minimap.render();
    return { state, minimap };
  };
  /** The element carrying .dsh-minimap: the returned element itself or its descendant. */
  const pageOf = (element: HTMLElement): HTMLElement =>
    element.matches(".dsh-minimap") ? element : element.querySelector<HTMLElement>(".dsh-minimap")!;
  const isHidden = (element: HTMLElement): boolean => {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.hidden || node.style.display === "none" || node.style.visibility === "hidden") return true;
    }
    return false;
  };
  const px = (value: string): number => parseFloat(value);
  const fakeRect = (element: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void => {
    const full = { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => ({}) };
    element.getBoundingClientRect = () => full as DOMRect;
  };
  const fire = (target: Element | Window, type: string, x: number, y: number): void => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type.endsWith("up") ? 0 : 1 }));
  };
  const press = (target: Element, x: number, y: number): void => {
    for (const type of ["pointerdown", "mousedown"]) fire(target, type, x, y);
    for (const type of ["pointerup", "mouseup", "click"]) fire(target, type, x, y);
  };

  it("10b.3a the minimap element is labelled Poster overview and holds a .dsh-minimap page", () => {
    const { minimap } = mount();
    const labelled = minimap.element.matches('[aria-label="Poster overview"]') || minimap.element.querySelector('[aria-label="Poster overview"]') !== null;
    expect(labelled).toBe(true);
    expect(pageOf(minimap.element)).not.toBeNull();
    expect(pageOf(minimap.element).classList.contains("dsh-minimap")).toBe(true);
  });

  it("10b.3a the page is drawn 160 px wide keeping the page aspect", () => {
    const { minimap } = mount({ pageValue: { width: 1600, height: 2400 } });
    const page = pageOf(minimap.element);
    expect(px(page.style.width)).toBeCloseTo(160, 5);
    expect(px(page.style.height)).toBeCloseTo(240, 5);
  });

  it("10b.3a a landscape page keeps its aspect at 160 px wide", () => {
    const { minimap } = mount({ pageValue: { width: 800, height: 400 }, viewportValue: { left: 0, top: 0, width: 400, height: 400 } });
    const page = pageOf(minimap.element);
    expect(px(page.style.width)).toBeCloseTo(160, 5);
    expect(px(page.style.height)).toBeCloseTo(80, 5);
  });

  it("10b.3a one .dsh-minimap-box per box, scaled to the 160 px page", () => {
    const { minimap } = mount({ boxesValue: [{ left: 100, top: 200, width: 400, height: 300 }, { left: 800, top: 1000, width: 200, height: 500 }] });
    const boxes = [...minimap.element.querySelectorAll<HTMLElement>(".dsh-minimap-box")];
    expect(boxes).toHaveLength(2);
    expect(px(boxes[0]!.style.left)).toBeCloseTo(10, 5);
    expect(px(boxes[0]!.style.top)).toBeCloseTo(20, 5);
    expect(px(boxes[0]!.style.width)).toBeCloseTo(40, 5);
    expect(px(boxes[0]!.style.height)).toBeCloseTo(30, 5);
    expect(px(boxes[1]!.style.left)).toBeCloseTo(80, 5);
    expect(px(boxes[1]!.style.top)).toBeCloseTo(100, 5);
    expect(px(boxes[1]!.style.width)).toBeCloseTo(20, 5);
    expect(px(boxes[1]!.style.height)).toBeCloseTo(50, 5);
  });

  it("10b.3a the viewport is drawn as .dsh-minimap-view scaled to the page", () => {
    const { minimap } = mount({ viewportValue: { left: 160, top: 480, width: 800, height: 1200 } });
    const view = minimap.element.querySelector<HTMLElement>(".dsh-minimap-view")!;
    expect(view).not.toBeNull();
    expect(px(view.style.left)).toBeCloseTo(16, 5);
    expect(px(view.style.top)).toBeCloseTo(48, 5);
    expect(px(view.style.width)).toBeCloseTo(80, 5);
    expect(px(view.style.height)).toBeCloseTo(120, 5);
  });

  it("10b.3a the minimap is visible while part of the page is out of view", () => {
    const { minimap } = mount();
    expect(isHidden(minimap.element)).toBe(false);
  });

  it("10b.3a render redraws the boxes and the viewport from the port", () => {
    const { state, minimap } = mount({ boxesValue: [{ left: 0, top: 0, width: 160, height: 240 }] });
    expect(minimap.element.querySelectorAll(".dsh-minimap-box")).toHaveLength(1);
    state.boxesValue = [{ left: 0, top: 0, width: 160, height: 240 }, { left: 320, top: 480, width: 160, height: 240 }, { left: 640, top: 960, width: 160, height: 240 }];
    state.viewportValue = { left: 320, top: 480, width: 800, height: 1200 };
    minimap.render();
    expect(minimap.element.querySelectorAll(".dsh-minimap-box")).toHaveLength(3);
    const view = minimap.element.querySelector<HTMLElement>(".dsh-minimap-view")!;
    expect(px(view.style.left)).toBeCloseTo(32, 5);
    expect(px(view.style.top)).toBeCloseTo(48, 5);
  });

  it("10b.3a the minimap is hidden when page() is null", () => {
    const { minimap } = mount({ pageValue: null, viewportValue: null });
    expect(isHidden(minimap.element)).toBe(true);
  });

  it("10b.3a the minimap is hidden when the whole page is visible", () => {
    const { minimap } = mount({ viewportValue: { left: 0, top: 0, width: 1600, height: 2400 } });
    expect(isHidden(minimap.element)).toBe(true);
  });

  it("10b.3a the minimap is hidden when the viewport is larger than the page", () => {
    const { minimap } = mount({ viewportValue: { left: -100, top: -100, width: 2000, height: 3000 } });
    expect(isHidden(minimap.element)).toBe(true);
  });

  it("10b.3a render shows the minimap again once the page no longer fits and hides it when it does", () => {
    const { state, minimap } = mount({ viewportValue: { left: 0, top: 0, width: 1600, height: 2400 } });
    expect(isHidden(minimap.element)).toBe(true);
    state.viewportValue = { left: 0, top: 0, width: 800, height: 1200 };
    minimap.render();
    expect(isHidden(minimap.element)).toBe(false);
    state.pageValue = null;
    minimap.render();
    expect(isHidden(minimap.element)).toBe(true);
  });

  it("A10 minimap: a click calls panTo with the page point under the pointer", () => {
    const { state, minimap } = mount();
    const page = pageOf(minimap.element);
    fakeRect(page, { left: 10, top: 20, width: 160, height: 240 });
    fakeRect(minimap.element, { left: 10, top: 20, width: 160, height: 240 });
    press(page, 10 + 80, 20 + 120);
    expect(state.panTo).toHaveBeenCalled();
    const last = state.panTo.mock.calls[state.panTo.mock.calls.length - 1]![0] as { x: number; y: number };
    expect(last.x).toBeCloseTo(800, 3);
    expect(last.y).toBeCloseTo(1200, 3);
  });

  it("10b.3a a click near the top left corner pans to the matching page point", () => {
    const { state, minimap } = mount();
    const page = pageOf(minimap.element);
    fakeRect(page, { left: 0, top: 0, width: 160, height: 240 });
    fakeRect(minimap.element, { left: 0, top: 0, width: 160, height: 240 });
    press(page, 16, 24);
    const last = state.panTo.mock.calls[state.panTo.mock.calls.length - 1]![0] as { x: number; y: number };
    expect(last.x).toBeCloseTo(160, 3);
    expect(last.y).toBeCloseTo(240, 3);
  });

  it("10b.3a dragging the pointer pans to the page point under it as it moves", () => {
    const { state, minimap } = mount();
    const page = pageOf(minimap.element);
    fakeRect(page, { left: 0, top: 0, width: 160, height: 240 });
    fakeRect(minimap.element, { left: 0, top: 0, width: 160, height: 240 });
    fire(page, "pointerdown", 40, 60);
    fire(page, "mousedown", 40, 60);
    state.panTo.mockClear();
    for (const type of ["pointermove", "mousemove"]) fire(page, type, 120, 180);
    fire(page, "pointerup", 120, 180);
    fire(page, "mouseup", 120, 180);
    expect(state.panTo).toHaveBeenCalled();
    const last = state.panTo.mock.calls[state.panTo.mock.calls.length - 1]![0] as { x: number; y: number };
    expect(last.x).toBeCloseTo(1200, 3);
    expect(last.y).toBeCloseTo(1800, 3);
  });

  it("10b.3a moving the pointer without pressing does not pan", () => {
    const { state, minimap } = mount();
    const page = pageOf(minimap.element);
    fakeRect(page, { left: 0, top: 0, width: 160, height: 240 });
    fakeRect(minimap.element, { left: 0, top: 0, width: 160, height: 240 });
    for (const type of ["pointermove", "mousemove"]) fire(page, type, 120, 180);
    expect(state.panTo).not.toHaveBeenCalled();
  });
});

describe("10b.3b fitRectZoom", () => {
  it("10b.3b fits a rect plus padding into the view by the tighter side", () => {
    // width: (800 - 100) / 1000 = 0.7, height: (600 - 100) / 500 = 1
    expect(fitRectZoom({ width: 1000, height: 500 }, { width: 800, height: 600 }, 50)).toBe(70);
  });

  it("10b.3b is limited by the height when the rect is tall", () => {
    // width: 760 / 400 = 1.9, height: 560 / 1000 = 0.56
    expect(fitRectZoom({ width: 400, height: 1000 }, { width: 800, height: 600 }, 20)).toBe(56);
  });

  it("10b.3b floors to an integer percent", () => {
    expect(fitRectZoom({ width: 300, height: 300 }, { width: 1000, height: 1000 }, 0)).toBe(333);
  });

  it("10b.3b floors a result just below a whole percent", () => {
    // 100 * 799 / 1000 = 79.9
    expect(fitRectZoom({ width: 1000, height: 1000 }, { width: 799, height: 2000 }, 0)).toBe(79);
  });

  it("10b.3b clamps to 400 at most", () => {
    expect(fitRectZoom({ width: 100, height: 100 }, { width: 1000, height: 800 }, 0)).toBe(400);
  });

  it("10b.3b clamps to 10 at least", () => {
    expect(fitRectZoom({ width: 10000, height: 10000 }, { width: 500, height: 500 }, 0)).toBe(10);
  });

  it("10b.3b clamps to 10 when the padding leaves no room", () => {
    expect(fitRectZoom({ width: 100, height: 100 }, { width: 80, height: 80 }, 50)).toBe(10);
  });

  it("10b.3b more padding gives a smaller zoom", () => {
    const view = { width: 1000, height: 1000 };
    const rect = { width: 500, height: 500 };
    expect(fitRectZoom(rect, view, 100)).toBeLessThan(fitRectZoom(rect, view, 0));
  });
});

describe("10b.3b zoom to section button", () => {
  const baseSurface = (): ShellZoomSurface => ({ percent: () => 100, isFit: () => false, setZoom: jest.fn(), setTool: jest.fn() });
  const labelled = (element: HTMLElement, label: string): HTMLButtonElement | null => element.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

  it("10b.3b the zoom bar shows a Zoom to section button when the surface has zoomToRect", () => {
    const surface: ShellZoomSurface = { ...baseSurface(), zoomToRect: jest.fn(), viewport: () => null };
    const { element } = createZoomBar(surface);
    document.body.append(element);
    const button = labelled(element, "Zoom to section");
    expect(button).not.toBeNull();
    expect(button!.tagName).toBe("BUTTON");
  });

  it("10b.3b the Zoom to section button carries the zoom-in icon", () => {
    const surface: ShellZoomSurface = { ...baseSurface(), zoomToRect: jest.fn(), viewport: () => null };
    const { element } = createZoomBar(surface);
    const button = labelled(element, "Zoom to section")!;
    const markup = renderIcon("zoom-in" as never);
    expect(markup).not.toContain("undefined");
    expect(button.innerHTML).toContain(markup);
  });

  it("10b.3b the zoom bar has no Zoom to section button when the surface lacks zoomToRect", () => {
    const { element } = createZoomBar(baseSurface());
    expect(labelled(element, "Zoom to section")).toBeNull();
  });

  it("10b.3b the zoom bar keeps its other buttons beside Zoom to section", () => {
    const surface: ShellZoomSurface = { ...baseSurface(), zoomToRect: jest.fn(), viewport: () => null };
    const { element } = createZoomBar(surface);
    for (const name of ["Select", "Hand", "Zoom out", "Zoom in", "Fit"]) expect(labelled(element, name)).not.toBeNull();
  });
});

describe("10b.3b Z key", () => {
  const platform = (value: string): void => {
    Object.defineProperty(window.navigator, "platform", { value, configurable: true });
    Object.defineProperty(window.navigator, "userAgent", { value: `Mozilla/5.0 (${value})`, configurable: true });
  };
  const unbinders: Array<() => void> = [];
  beforeEach(() => platform("Linux x86_64"));
  afterEach(() => { while (unbinders.length) unbinders.pop()!(); });

  const mount = (actions: ShellKeyActions) => {
    const root = document.createElement("div");
    const input = document.createElement("input");
    root.append(input);
    document.body.append(root);
    unbinders.push(bindShellKeys(root, actions));
    return { root, input };
  };
  const press = (target: Element, init: KeyboardEventInit & { key: string }): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it("A10 zoom to section: Z calls zoomToSelection", () => {
    const zoomToSelection = jest.fn();
    const { root } = mount({ zoomToSelection });
    const event = press(root, { key: "z" });
    expect(zoomToSelection).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("10b.3b a capital Z without modifiers also calls zoomToSelection", () => {
    const zoomToSelection = jest.fn();
    const { root } = mount({ zoomToSelection });
    press(root, { key: "Z" });
    expect(zoomToSelection).toHaveBeenCalledTimes(1);
  });

  it("10b.3b Z does nothing while typing in a field", () => {
    const zoomToSelection = jest.fn();
    const { input } = mount({ zoomToSelection });
    const event = press(input, { key: "z" });
    expect(zoomToSelection).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("10b.3b Z does nothing inside editable text", () => {
    const zoomToSelection = jest.fn();
    const { root } = mount({ zoomToSelection });
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    root.append(editable);
    press(editable, { key: "z" });
    expect(zoomToSelection).not.toHaveBeenCalled();
  });

  it("10b.3b Z is left to the page when zoomToSelection is not given", () => {
    const { root } = mount({ undo: jest.fn() });
    const event = press(root, { key: "z" });
    expect(event.defaultPrevented).toBe(false);
  });

  it("10b.3b Mod+Z still undoes and does not zoom to the selection", () => {
    const zoomToSelection = jest.fn();
    const undo = jest.fn();
    const { root } = mount({ zoomToSelection, undo });
    press(root, { key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(zoomToSelection).not.toHaveBeenCalled();
  });
});
