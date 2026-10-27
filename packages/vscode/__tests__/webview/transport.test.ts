/** Pins the webview page channel: one acquireVsCodeApi() call serves the transport, the prefs and the sharing client, and the transport passes only typed or channel messages. */
/// <reference lib="dom" />
/// <reference path="../../src/webviewGlobals.d.ts" />
import { createWebviewChannel, createWebviewPrefs, createWebviewTransport } from "../../src/webview";

type Listener = (event: { data: unknown }) => void;

function stubWindow(): { dispatch: (data: unknown) => void; listeners: Set<Listener> } {
  const listeners = new Set<Listener>();
  (globalThis as { window?: unknown }).window = {
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  return { listeners, dispatch: (data) => listeners.forEach((listener) => listener({ data })) };
}

function stubApi(state: unknown = undefined): { postMessage: jest.Mock; getState: jest.Mock; setState: jest.Mock } {
  return { postMessage: jest.fn(), getState: jest.fn(() => state), setState: jest.fn() };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
});

describe("createWebviewChannel", () => {
  it("acquires the VS Code API once and builds the transport, the prefs and the sharing client on it", () => {
    stubWindow();
    const api = stubApi({ view: "list" });
    const acquire = jest.fn(() => api);
    (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = acquire;

    const { transport, prefs, sharing } = createWebviewChannel<{ type: "out" }, { type: string }>();

    expect(acquire).toHaveBeenCalledTimes(1);
    transport.post({ type: "out" });
    expect(api.postMessage).toHaveBeenCalledWith({ type: "out" });
    prefs.save({ detailsWidth: 300 } as never);
    expect(api.setState).toHaveBeenCalledWith(expect.objectContaining({ view: "list", detailsWidth: 300 }));
    expect(sharing).toBeDefined();
  });
});

describe("createWebviewTransport", () => {
  it("hands the handler a message with a string type or a channel key and ignores the rest, until unsubscribed", () => {
    const win = stubWindow();
    const handler = jest.fn();
    const unsubscribe = createWebviewTransport<unknown, object>(stubApi()).subscribe(handler);

    win.dispatch({ type: "ready" });
    win.dispatch({ channel: "share", payload: 1 });
    win.dispatch({ type: 3 });
    win.dispatch("text");
    win.dispatch(null);
    expect(handler.mock.calls).toEqual([[{ type: "ready" }], [{ channel: "share", payload: 1 }]]);

    unsubscribe();
    win.dispatch({ type: "later" });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("createWebviewPrefs", () => {
  it("loads normalized prefs from the webview state and merges a saved patch into it", () => {
    const api = stubApi("not an object");
    const prefs = createWebviewPrefs(api);
    expect(prefs.load()).toBeDefined();
    prefs.save({ detailsWidth: 200 } as never);
    expect(api.setState).toHaveBeenCalledWith({ detailsWidth: 200 });
  });
});
