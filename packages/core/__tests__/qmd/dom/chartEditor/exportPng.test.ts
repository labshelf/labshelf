/** @jest-environment jsdom */
/**
 * Tests exportChartPng (plan charts, D6, 2.1): the figure drawn into a detached element, a PNG taken from it through
 * Plotly.toImage at 640x400 px and scale 2 by default, and null when toImage throws. Plotly is a fake; nothing real is loaded.
 */
import { exportChartPng } from "../../../../src/qmd/dom/chartEditor/openChartEditor";
import type { ChartFigure } from "../../../../src/qmd/chart/figure";
import type { PlotlyApi } from "../../../../src/qmd/dom/plotView";

const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGNoaPg/IIhh1OJRi0ctHrV41OJRi0ctHrV45FgMAPGJPTtbDo1MAAAAAElFTkSuQmCC";

interface ToImageOptions { format: string; width: number; height: number; scale: number }

interface Fake {
  api: PlotlyApi;
  react: jest.Mock;
  purge: jest.Mock;
  toImage: jest.Mock;
  /** Whether the element Plotly.react drew into was attached to the document at the time of the call. */
  connectedAtReact: boolean[];
}

function fakePlotly(toImage: (root: HTMLElement, options: ToImageOptions) => Promise<string> = async () => DATA_URL): Fake {
  const connectedAtReact: boolean[] = [];
  const react = jest.fn(async (root: HTMLElement, _data: readonly object[], _layout?: object, _config?: object): Promise<unknown> => {
    connectedAtReact.push(root.isConnected);
    return undefined;
  });
  const purge = jest.fn((_root: HTMLElement): void => undefined);
  const toImageMock = jest.fn(toImage);
  const api = {
    react,
    purge,
    relayout: jest.fn(async () => undefined),
    downloadImage: jest.fn(async () => undefined),
    toImage: toImageMock,
    Plots: { resize: jest.fn() },
  } as unknown as PlotlyApi;
  return { api, react, purge, toImage: toImageMock, connectedAtReact };
}

const FIGURE: ChartFigure = {
  data: [{ type: "scatter", mode: "lines", x: [1, 2, 3], y: [10, 20, 30] }],
  layout: { title: { text: "Growth" } },
};

afterEach(() => { document.body.innerHTML = ""; });

describe("exportChartPng", () => {
  it("2.1a draws the figure into a detached element, not into the page", async () => {
    const fake = fakePlotly();
    await exportChartPng(fake.api, FIGURE);
    expect(fake.react).toHaveBeenCalledTimes(1);
    const [root, data] = fake.react.mock.calls[0] as [HTMLElement, unknown[]];
    expect(data).toEqual(FIGURE.data);
    expect(fake.connectedAtReact).toEqual([false]);
    expect(root.isConnected).toBe(false);
    expect(document.body.childElementCount).toBe(0);
  });

  it("2.1a takes a PNG of the drawn element at 640x400 px, scale 2, and returns the data URL", async () => {
    const fake = fakePlotly();
    const result = await exportChartPng(fake.api, FIGURE);
    expect(result).toBe(DATA_URL);
    expect(fake.toImage).toHaveBeenCalledTimes(1);
    const [root, options] = fake.toImage.mock.calls[0] as [HTMLElement, ToImageOptions];
    expect(root).toBe(fake.react.mock.calls[0]![0]);
    expect(options).toEqual({ format: "png", width: 640, height: 400, scale: 2 });
  });

  it("2.1a takes the PNG at the size given", async () => {
    const fake = fakePlotly();
    await exportChartPng(fake.api, FIGURE, { widthPx: 800, heightPx: 500 });
    const options = fake.toImage.mock.calls[0]![1] as ToImageOptions;
    expect(options).toEqual({ format: "png", width: 800, height: 500, scale: 2 });
  });

  it("2.1a asks for the image only after the figure is drawn", async () => {
    await exportChartPng(fakePlotly().api, FIGURE);
    let finish!: () => void;
    const fake = fakePlotly();
    fake.react.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pending = exportChartPng(fake.api, FIGURE);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.toImage).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(fake.toImage).toHaveBeenCalledTimes(1);
  });

  it("2.1a purges the offscreen plot after the image is taken", async () => {
    const fake = fakePlotly();
    await exportChartPng(fake.api, FIGURE);
    expect(fake.purge).toHaveBeenCalledWith(fake.react.mock.calls[0]![0]);
  });

  it("2.1c returns null when toImage rejects", async () => {
    const fake = fakePlotly(async () => { throw new Error("blocked by CSP"); });
    await expect(exportChartPng(fake.api, FIGURE)).resolves.toBeNull();
  });

  it("2.1c returns null when toImage throws before returning a promise", async () => {
    const fake = fakePlotly(() => { throw new Error("no canvas"); });
    await expect(exportChartPng(fake.api, FIGURE)).resolves.toBeNull();
  });
});
