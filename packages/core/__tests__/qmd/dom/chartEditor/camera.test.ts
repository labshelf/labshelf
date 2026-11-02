/** @jest-environment jsdom */
/**
 * Tests cameraOfRelayout and watchCamera (plan charts, spec 6.2, D13): reading the scene camera out of a plotly_relayout event, rounded to 4 decimals,
 * and subscribing to a plot div's `on('plotly_relayout', …)` when the div has `on`.
 */
import { cameraOfRelayout, watchCamera } from "../../../../src/qmd/dom/chartEditor/camera";

type Handler = (event: Record<string, unknown>) => void;
type Plot = HTMLElement & { on?: unknown; removeListener?: unknown };

const RAW = { eye: { x: 1.23456, y: -0.98764, z: 0.00004 }, center: { x: 0.11114, y: 0.2, z: -0.33336 }, up: { x: 0, y: 0, z: 1.00006 } };
const ROUNDED = { eye: { x: 1.2346, y: -0.9876, z: 0 }, center: { x: 0.1111, y: 0.2, z: -0.3334 }, up: { x: 0, y: 0, z: 1.0001 } };

describe("6.2c cameraOfRelayout", () => {
  test("6.2c returns the scene.camera of an event with every number rounded to 4 decimals", () => {
    expect(cameraOfRelayout({ "scene.camera": RAW })).toEqual(ROUNDED);
  });

  test("6.2c keeps numbers that already have at most 4 decimals", () => {
    const camera = { eye: { x: 1.5, y: -2, z: 0.25 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    expect(cameraOfRelayout({ "scene.camera": camera })).toEqual(camera);
  });

  test("6.2c accepts a camera with only an eye", () => {
    expect(cameraOfRelayout({ "scene.camera": { eye: { x: 1.23456, y: 2, z: 3 } } })).toEqual({ eye: { x: 1.2346, y: 2, z: 3 } });
  });

  test("6.2c does not change the event it reads", () => {
    const camera = JSON.parse(JSON.stringify(RAW)) as typeof RAW;
    cameraOfRelayout({ "scene.camera": camera });
    expect(camera).toEqual(RAW);
  });

  test("6.2c returns null for an event without scene.camera", () => {
    expect(cameraOfRelayout({})).toBeNull();
    expect(cameraOfRelayout({ "xaxis.range": [0, 1] })).toBeNull();
  });

  test("6.2c returns null when scene.camera is not a camera", () => {
    expect(cameraOfRelayout({ "scene.camera": undefined })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": null })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": "front" })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": {} })).toBeNull();
  });

  test("6.2c returns null when the eye is missing or has a non-numeric component", () => {
    expect(cameraOfRelayout({ "scene.camera": { center: RAW.center, up: RAW.up } })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": { eye: { x: 1, y: "2", z: 3 } } })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": { eye: { x: 1, y: 2 } } })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": { eye: { x: 1, y: Number.NaN, z: 3 } } })).toBeNull();
  });
});

describe("6.2c watchCamera", () => {
  function plotWithOn(): { plot: Plot; on: jest.Mock; removeListener: jest.Mock; handler(): Handler } {
    const plot = document.createElement("div") as Plot;
    const on = jest.fn();
    const removeListener = jest.fn();
    plot.on = on;
    plot.removeListener = removeListener;
    return { plot, on, removeListener, handler: () => on.mock.calls.find((c) => c[0] === "plotly_relayout")![1] as Handler };
  }

  test("6.2c subscribes to plotly_relayout on the plot div", () => {
    const { plot, on } = plotWithOn();
    watchCamera(plot, () => undefined);
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]![0]).toBe("plotly_relayout");
    expect(typeof on.mock.calls[0]![1]).toBe("function");
  });

  test("6.2c calls onCamera with the rounded camera of an event that has one", () => {
    const { plot, handler } = plotWithOn();
    const seen: unknown[] = [];
    watchCamera(plot, (camera) => seen.push(camera));
    handler()({ "scene.camera": RAW });
    expect(seen).toEqual([ROUNDED]);
  });

  test("6.2c calls onCamera once for each accepted event", () => {
    const { plot, handler } = plotWithOn();
    const onCamera = jest.fn();
    watchCamera(plot, onCamera);
    handler()({ "scene.camera": RAW });
    handler()({ "scene.camera": { eye: { x: 2, y: 2, z: 2 } } });
    expect(onCamera).toHaveBeenCalledTimes(2);
  });

  test("6.2c ignores events without a valid camera", () => {
    const { plot, handler } = plotWithOn();
    const onCamera = jest.fn();
    watchCamera(plot, onCamera);
    handler()({ "xaxis.range": [0, 1] });
    handler()({ "scene.camera": { eye: { x: "a" } } });
    handler()({});
    expect(onCamera).not.toHaveBeenCalled();
  });

  test("6.2c the unsubscribe removes the same listener that was added", () => {
    const { plot, on, removeListener } = plotWithOn();
    const stop = watchCamera(plot, () => undefined);
    expect(removeListener).not.toHaveBeenCalled();
    stop();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener.mock.calls[0]![0]).toBe("plotly_relayout");
    expect(removeListener.mock.calls[0]![1]).toBe(on.mock.calls[0]![1]);
  });

  test("6.2c a plot div without on subscribes nothing and still returns an unsubscribe", () => {
    const plot = document.createElement("div");
    const stop = watchCamera(plot, () => undefined);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });

  test("6.2c the unsubscribe is safe when the div has on but no removeListener", () => {
    const plot = document.createElement("div") as Plot;
    plot.on = jest.fn();
    const stop = watchCamera(plot, () => undefined);
    expect(() => stop()).not.toThrow();
  });
});
