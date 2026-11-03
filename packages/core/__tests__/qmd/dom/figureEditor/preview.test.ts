/** @jest-environment jsdom */
/**
 * Tests the chart preview (plan charts, spec 2.3, D9): a Plotly view in the given root that redraws through Plotly.react at most once per
 * animation frame, zooms and fits the axis ranges view-only, and purges on destroy. Plotly is a fake PlotlyApi behind the loader; frames are queued by hand.
 */
import type { ChartFigure } from "../../../../src/qmd/chart/figure";
import { mountChartPreview } from "../../../../src/qmd/dom/figureEditor/preview";
import { deferred, fakePlotly } from "../plotViewHarness";
import { fakeFrames, settle, type Frames } from "../chartEditor/chartEditorHarness";

function figure(name: string, extra: Record<string, unknown> = {}): ChartFigure {
  return {
    data: [{ type: "scatter", name, x: [0, 10], y: [0, 100] }],
    layout: { xaxis: { range: [0, 10] }, yaxis: { range: [0, 100] }, ...extra },
  };
}

let frames: Frames;
let roots: HTMLElement[] = [];

function setup(manual = false): { root: HTMLElement; fake: ReturnType<typeof fakePlotly>; preview: ReturnType<typeof mountChartPreview> } {
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  const fake = fakePlotly(manual);
  // Plotly keeps the laid-out axis ranges on the element it drew into; a real draw does, so the fake does too.
  fake.react.mockImplementation((el: HTMLElement, data: readonly object[], layout?: object) => {
    (el as unknown as { _fullLayout: unknown })._fullLayout = { xaxis: { range: [0, 10] }, yaxis: { range: [0, 100] } };
    (el as unknown as { data: unknown; layout: unknown }).data = data;
    (el as unknown as { layout: unknown }).layout = layout;
    return Promise.resolve();
  });
  const preview = mountChartPreview(root, async () => fake.api);
  return { root, fake, preview };
}

beforeEach(() => { frames = fakeFrames(); });
afterEach(() => {
  for (const r of roots) r.remove();
  roots = [];
  frames.restore();
});

/** The [min, max] a relayout update sets for an axis, in either of Plotly's key forms. */
function rangeOf(update: Record<string, unknown>, axis: "xaxis" | "yaxis"): [number, number] | undefined {
  const whole = update[`${axis}.range`] as [number, number] | undefined;
  if (whole !== undefined) return whole;
  const lo = update[`${axis}.range[0]`] as number | undefined;
  const hi = update[`${axis}.range[1]`] as number | undefined;
  return lo !== undefined && hi !== undefined ? [lo, hi] : undefined;
}

describe("2.3a the preview redraws once per frame", () => {
  test("2.3a draw sends the figure's data and layout to Plotly.react on an element inside the root", async () => {
    const { root, fake, preview } = setup();
    const fig = figure("one");
    preview.draw(fig);
    await settle(frames);
    expect(fake.react).toHaveBeenCalledTimes(1);
    const call = fake.react.mock.calls[0] as unknown[];
    expect(root.contains(call[0] as HTMLElement)).toBe(true);
    expect(call[1]).toEqual(fig.data);
    expect((call[2] as Record<string, unknown>).xaxis).toMatchObject({ range: [0, 10] });
  });

  test("2.3a several draws in one frame call Plotly.react once with the last figure", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    preview.draw(figure("two"));
    preview.draw(figure("three"));
    await settle(frames);
    expect(fake.react).toHaveBeenCalledTimes(1);
    expect((fake.react.mock.calls[0] as unknown[])[1]).toEqual(figure("three").data);
  });

  test("2.3a draws in different frames each call Plotly.react", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    await settle(frames);
    preview.draw(figure("two"));
    await settle(frames);
    expect(fake.react).toHaveBeenCalledTimes(2);
    expect((fake.react.mock.calls[1] as unknown[])[1]).toEqual(figure("two").data);
  });

  test("2.3a nothing is drawn before the frame runs", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(fake.react).not.toHaveBeenCalled();
    await settle(frames);
    expect(fake.react).toHaveBeenCalledTimes(1);
  });

  test("2.3a the Plotly module is asked for through the loader, and a slow load does not lose the figure", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    roots.push(root);
    const fake = fakePlotly();
    const gate = deferred<typeof fake.api>();
    const preview = mountChartPreview(root, () => gate.promise);
    preview.draw(figure("late"));
    await settle(frames);
    expect(fake.react).not.toHaveBeenCalled();
    gate.resolve(fake.api);
    await settle(frames);
    expect(fake.react).toHaveBeenCalledTimes(1);
    expect((fake.react.mock.calls[0] as unknown[])[1]).toEqual(figure("late").data);
  });

  test("2.3a destroy purges the drawn element", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    await settle(frames);
    const drawn = (fake.react.mock.calls[0] as unknown[])[0];
    preview.destroy();
    expect(fake.purge).toHaveBeenCalledWith(drawn);
  });

  test("2.3a a draw after destroy does not call Plotly.react", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    await settle(frames);
    preview.destroy();
    fake.react.mockClear();
    preview.draw(figure("two"));
    await settle(frames);
    expect(fake.react).not.toHaveBeenCalled();
  });

  test("2.3a a draw still waiting for its frame when destroy runs never reaches Plotly", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    preview.destroy();
    await settle(frames);
    expect(fake.react).not.toHaveBeenCalled();
  });
});

describe("2.3a zoom and View full are view-only", () => {
  test("2.3a zoom in narrows both axis ranges through relayout", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    await settle(frames);
    preview.zoom(1);
    await settle(frames);
    expect(fake.relayout).toHaveBeenCalledTimes(1);
    const update = (fake.relayout.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const x = rangeOf(update, "xaxis")!;
    const y = rangeOf(update, "yaxis")!;
    expect(x[1] - x[0]).toBeGreaterThan(0);
    expect(x[1] - x[0]).toBeLessThan(10);
    expect(y[1] - y[0]).toBeGreaterThan(0);
    expect(y[1] - y[0]).toBeLessThan(100);
  });

  test("2.3a zoom out widens both axis ranges through relayout", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    await settle(frames);
    preview.zoom(-1);
    await settle(frames);
    expect(fake.relayout).toHaveBeenCalledTimes(1);
    const update = (fake.relayout.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    const x = rangeOf(update, "xaxis")!;
    const y = rangeOf(update, "yaxis")!;
    expect(x[1] - x[0]).toBeGreaterThan(10);
    expect(y[1] - y[0]).toBeGreaterThan(100);
  });

  test("2.3a View full asks both axes to autorange", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    await settle(frames);
    preview.viewFull();
    await settle(frames);
    expect(fake.relayout).toHaveBeenCalledTimes(1);
    const update = (fake.relayout.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(update["xaxis.autorange"]).toBe(true);
    expect(update["yaxis.autorange"]).toBe(true);
  });

  test("2.3a zoom and View full do not redraw the figure", async () => {
    const { fake, preview } = setup();
    preview.draw(figure("one"));
    await settle(frames);
    fake.react.mockClear();
    preview.zoom(1);
    preview.zoom(-1);
    preview.viewFull();
    await settle(frames);
    expect(fake.react).not.toHaveBeenCalled();
  });
});
