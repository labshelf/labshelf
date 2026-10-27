/**
 * @jest-environment jsdom
 *
 * The runtime request helper returns the reply's data and throws the background's error text; watchVisibility hears a page
 * showing again and the runtime broadcasts, and leaves no listener behind once disposed.
 */
const sendMessage = jest.fn();
const addListener = jest.fn();
const removeListener = jest.fn();
jest.mock("webextension-polyfill", () => ({
  runtime: {
    sendMessage: (m: unknown) => sendMessage(m),
    onMessage: { addListener: (l: unknown) => addListener(l), removeListener: (l: unknown) => removeListener(l) },
  },
}));

import { sendRuntime, watchVisibility } from "../../src/platform/bx";

describe("sendRuntime", () => {
  beforeEach(() => sendMessage.mockReset());

  it("sends the message and returns the data of an ok reply", async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { folders: [] } });
    expect(await sendRuntime({ type: "library.folders" })).toEqual({ folders: [] });
    expect(sendMessage).toHaveBeenCalledWith({ type: "library.folders" });
  });

  it("throws the error text of a refused reply", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "Not allowed from this page" });
    await expect(sendRuntime({ type: "library.folders" })).rejects.toThrow("Not allowed from this page");
  });
});

describe("watchVisibility", () => {
  const setVisibility = (state: "visible" | "hidden"): void => {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  let stop: (() => void) | undefined;
  beforeEach(() => { addListener.mockReset(); removeListener.mockReset(); });
  afterEach(() => { stop?.(); stop = undefined; });

  it("calls onVisible when the page shows again and not when it hides", () => {
    const onVisible = jest.fn();
    stop = watchVisibility({ onVisible });
    setVisibility("hidden");
    expect(onVisible).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it("hands the raw runtime message to onMessage and returns undefined so no other surface's request is answered", () => {
    const onMessage = jest.fn(() => "a Promise or any value would be wrong here");
    stop = watchVisibility({ onVisible: jest.fn(), onMessage });
    expect(addListener).toHaveBeenCalledTimes(1);
    const listener = addListener.mock.calls[0]![0] as (raw: unknown) => unknown;
    const raw = { type: "library.changed" };
    expect(listener(raw)).toBeUndefined();
    expect(onMessage).toHaveBeenCalledWith(raw);
  });

  it("registers no runtime listener without onMessage", () => {
    stop = watchVisibility({ onVisible: jest.fn() });
    expect(addListener).not.toHaveBeenCalled();
  });

  it("removes both listeners when disposed", () => {
    const onVisible = jest.fn();
    const dispose = watchVisibility({ onVisible, onMessage: jest.fn() });
    const listener = addListener.mock.calls[0]![0];
    dispose();
    setVisibility("visible");
    expect(onVisible).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
