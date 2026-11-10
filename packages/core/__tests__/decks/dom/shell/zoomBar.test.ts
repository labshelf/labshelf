/** @jest-environment jsdom */
// Spec 2.1: the generic deck shell core in decks/dom/shell/ — the zoom bar.
// Every part is driven through its factory and read back from the DOM it builds; no format logic is involved.
// Acceptance ids: A4 covers all six parts (header, insert bar, status, zoom bar, keys, layout); each test name says which.
import { closeMenu } from "../../../../src/ui/dom/index.js";
import { createZoomBar, type ShellZoomSurface } from "../../../../src/decks/dom/shell/index.js";
import { byLabel, click, hasIcon, q, text } from "./shellHarness.js";

afterEach(() => {
  closeMenu();
  document.body.replaceChildren();
});

describe("A4 zoom bar", () => {
  interface Fake extends ShellZoomSurface { percentValue: number; fitValue: boolean; setZoom: jest.Mock; setTool: jest.Mock }
  const surface = (percent = 100, fit = false): Fake => {
    const fake: Fake = {
      percentValue: percent, fitValue: fit,
      percent: () => fake.percentValue,
      isFit: () => fake.fitValue,
      setZoom: jest.fn((next: number | "fit") => { if (next === "fit") { fake.fitValue = true; fake.percentValue = 62; } else { fake.fitValue = false; fake.percentValue = next; } }),
      setTool: jest.fn(),
    };
    return fake;
  };
  const bar = (fake: Fake, options?: Parameters<typeof createZoomBar>[1]) => {
    const built = createZoomBar(fake, options);
    document.body.append(built.element);
    built.render();
    return built;
  };
  const label = (b: { element: HTMLElement }): string => text(q(b.element, ".dw-zoom-label"));

  it("A4 zoom bar is a toolbar labelled Zoom with its tools, rule and fit", () => {
    const { element } = bar(surface());
    expect(element.classList.contains("dw-zoombar")).toBe(true);
    expect(element.getAttribute("role")).toBe("toolbar");
    expect(element.getAttribute("aria-label")).toBe("Zoom");
    for (const name of ["Select", "Hand", "Zoom out", "Zoom in", "Fit"]) expect(byLabel(element, name).tagName).toBe("BUTTON");
    expect(element.querySelector(".dw-zoombar-rule")).not.toBeNull();
    expect(element.querySelector(".dw-zoom-label")).not.toBeNull();
  });

  it("A4 zoom bar tool buttons are button.dw-tool with titles and icons", () => {
    const { element } = bar(surface());
    const select = byLabel(element, "Select");
    const hand = byLabel(element, "Hand");
    expect(select.classList.contains("dw-tool")).toBe(true);
    expect(hand.classList.contains("dw-tool")).toBe(true);
    expect(select.title).toBe("Select (V)");
    expect(hand.title).toBe("Hand (H, or hold Space)");
    expect(hasIcon(select, "target")).toBe(true);
    expect(hasIcon(hand, "move")).toBe(true);
    expect(hasIcon(byLabel(element, "Zoom out"), "minus")).toBe(true);
    expect(hasIcon(byLabel(element, "Zoom in"), "plus")).toBe(true);
  });

  it("A4 zoom bar fit button reads Fit", () => {
    const fit = q(bar(surface()).element, "button.dw-zoom-fit");
    expect(text(fit)).toBe("Fit");
    expect(fit.getAttribute("aria-label")).toBe("Fit");
  });

  it.each([
    [100, 125], [125, 150], [124.9, 125], [10, 25], [9, 10], [67, 75], [300, 400], [399, 400], [60, 67],
  ])("A4 zoom bar zoom in from %d percent goes to %d", (from, to) => {
    const fake = surface(from);
    bar(fake).zoomIn();
    expect(fake.setZoom).toHaveBeenCalledTimes(1);
    expect(fake.setZoom).toHaveBeenCalledWith(to);
  });

  it.each([
    [100, 75], [125, 100], [125.1, 125], [400, 300], [401, 400], [25, 10], [11, 10], [60, 50], [34, 33],
  ])("A4 zoom bar zoom out from %d percent goes to %d", (from, to) => {
    const fake = surface(from);
    bar(fake).zoomOut();
    expect(fake.setZoom).toHaveBeenCalledTimes(1);
    expect(fake.setZoom).toHaveBeenCalledWith(to);
  });

  it("A4 zoom bar zoom in clamps at 400", () => {
    const fake = surface(400);
    bar(fake).zoomIn();
    expect(fake.setZoom.mock.calls.every(([next]) => next === 400)).toBe(true);
    expect(fake.percentValue).toBe(400);
  });

  it("A4 zoom bar zoom out clamps at 10", () => {
    const fake = surface(10);
    bar(fake).zoomOut();
    expect(fake.setZoom.mock.calls.every(([next]) => next === 10)).toBe(true);
    expect(fake.percentValue).toBe(10);
  });

  it("A4 zoom bar walks the steps one at a time on repeated zoom in", () => {
    const fake = surface(100);
    const zoom = bar(fake);
    for (let i = 0; i < 12; i++) zoom.zoomIn();
    const walked = Array.from(new Set(fake.setZoom.mock.calls.map(([next]) => next)));
    expect(walked).toEqual([125, 150, 200, 300, 400]);
  });

  it("A4 zoom bar buttons Zoom in and Zoom out act like the methods", () => {
    const fake = surface(100);
    const { element } = bar(fake);
    click(byLabel(element, "Zoom in"));
    expect(fake.setZoom).toHaveBeenLastCalledWith(125);
    click(byLabel(element, "Zoom out"));
    expect(fake.setZoom).toHaveBeenLastCalledWith(100);
  });

  it("A4 zoom bar Fit button and fit() call setZoom with fit", () => {
    const fake = surface(100);
    const zoom = bar(fake);
    click(q(zoom.element, "button.dw-zoom-fit"));
    expect(fake.setZoom).toHaveBeenLastCalledWith("fit");
    fake.setZoom.mockClear();
    zoom.fit();
    expect(fake.setZoom).toHaveBeenCalledTimes(1);
    expect(fake.setZoom).toHaveBeenCalledWith("fit");
  });

  it("A4 zoom bar label reads N% when not fit, rounded", () => {
    const zoom = bar(surface(99.6));
    expect(label(zoom)).toBe("100%");
  });

  it("A4 zoom bar label reads Fit · N% when fit", () => {
    const zoom = bar(surface(87.2, true));
    expect(label(zoom)).toBe("Fit · 87%");
  });

  it("A4 zoom bar render follows the surface", () => {
    const fake = surface(100);
    const zoom = bar(fake);
    expect(label(zoom)).toBe("100%");
    fake.percentValue = 50;
    zoom.render();
    expect(label(zoom)).toBe("50%");
  });

  it("A4 zoom bar every zoom change re-renders the label", () => {
    const fake = surface(100);
    const zoom = bar(fake);
    zoom.zoomIn();
    expect(label(zoom)).toBe("125%");
    zoom.zoomOut();
    zoom.zoomOut();
    expect(label(zoom)).toBe("75%");
    zoom.fit();
    expect(label(zoom)).toBe("Fit · 62%");
    click(byLabel(zoom.element, "Zoom in"));
    expect(label(zoom)).toBe("67%");
  });

  it("A4 zoom bar starts with the select tool", () => {
    expect(bar(surface()).tool()).toBe("select");
  });

  it("A4 zoom bar clicking Hand calls setTool and sets aria-pressed", () => {
    const fake = surface();
    const zoom = bar(fake);
    click(byLabel(zoom.element, "Hand"));
    expect(fake.setTool).toHaveBeenCalledWith("hand");
    expect(zoom.tool()).toBe("hand");
    expect(byLabel(zoom.element, "Hand").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(zoom.element, "Select").getAttribute("aria-pressed")).toBe("false");
  });

  it("A4 zoom bar clicking Select after Hand goes back", () => {
    const fake = surface();
    const zoom = bar(fake);
    click(byLabel(zoom.element, "Hand"));
    click(byLabel(zoom.element, "Select"));
    expect(fake.setTool).toHaveBeenLastCalledWith("select");
    expect(zoom.tool()).toBe("select");
    expect(byLabel(zoom.element, "Select").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(zoom.element, "Hand").getAttribute("aria-pressed")).toBe("false");
  });

  it("A4 zoom bar setTool calls the surface and updates the buttons", () => {
    const fake = surface();
    const zoom = bar(fake);
    zoom.setTool("hand");
    expect(fake.setTool).toHaveBeenCalledWith("hand");
    expect(zoom.tool()).toBe("hand");
    expect(byLabel(zoom.element, "Hand").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(zoom.element, "Select").getAttribute("aria-pressed")).toBe("false");
  });
});
