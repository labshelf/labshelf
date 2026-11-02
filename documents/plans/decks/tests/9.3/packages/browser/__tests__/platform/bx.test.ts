/**
 * @jest-environment jsdom
 *
 * The runtime request helper returns the reply's data and throws the background's error text; watchVisibility hears a page
 * showing again and the runtime broadcasts, and leaves no listener behind once disposed. downloadBytes and openBlobTab (spec 9.3) go
 * through bx.downloads.download and bx.tabs.create with a blob URL that is revoked after 60 s.
 */
const sendMessage = jest.fn();
const addListener = jest.fn();
const removeListener = jest.fn();
const downloadsDownload = jest.fn();
const tabsCreate = jest.fn();
jest.mock("webextension-polyfill", () => ({
  runtime: {
    sendMessage: (m: unknown) => sendMessage(m),
    onMessage: { addListener: (l: unknown) => addListener(l), removeListener: (l: unknown) => removeListener(l) },
  },
  downloads: { download: (o: unknown) => downloadsDownload(o) },
  tabs: { create: (o: unknown) => tabsCreate(o) },
}));

import * as bxModule from "../../src/platform/bx";
import { sendRuntime, watchVisibility } from "../../src/platform/bx";

// Reached through the module namespace so the existing tests keep compiling and running before spec 9.3 adds these exports.
type DownloadBytes = (bytes: Uint8Array, filename: string, mime: string) => Promise<void>;
type OpenBlobTab = (text: string, mime: string, fragment?: string) => Promise<void>;
function exported<T>(name: string): T {
  const value = (bxModule as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") throw new Error(`not implemented: bx.${name}`);
  return value as T;
}
const downloadBytes: DownloadBytes = (...args) => exported<DownloadBytes>("downloadBytes")(...args);
const openBlobTab: OpenBlobTab = (...args) => exported<OpenBlobTab>("openBlobTab")(...args);

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

describe("downloadBytes and openBlobTab", () => {
  const BLOB_URL = "blob:labshelf/1234";
  let blobs: Blob[];
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;
  const originalCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  const originalRevoke = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;

  beforeEach(() => {
    blobs = [];
    createObjectURL = jest.fn((blob: Blob) => { blobs.push(blob); return BLOB_URL; });
    revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
    downloadsDownload.mockReset().mockResolvedValue(1);
    tabsCreate.mockReset().mockResolvedValue({ id: 7 });
  });
  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(URL, "createObjectURL", { value: originalCreate, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: originalRevoke, configurable: true, writable: true });
  });

  /** Reads a jsdom Blob's bytes. */
  const bytesOf = (blob: Blob): Promise<number[]> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

  it("9.3c downloadBytes downloads a blob of the bytes with the mime through bx.downloads with saveAs", async () => {
    const bytes = Uint8Array.from([37, 80, 68, 70, 0, 255]);
    await downloadBytes(bytes, "talk.pdf", "application/pdf");
    expect(downloadsDownload).toHaveBeenCalledWith({ url: BLOB_URL, filename: "talk.pdf", saveAs: true });
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe("application/pdf");
    expect(await bytesOf(blobs[0]!)).toEqual(Array.from(bytes));
  });

  it("9.3c downloadBytes revokes its URL after 60 s and not before", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    await downloadBytes(Uint8Array.from([1, 2, 3]), "talk.html", "text/html");
    jest.advanceTimersByTime(59_000);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it("9.3c openBlobTab opens a tab on the blob URL with #<fragment> holding the text with the mime", async () => {
    await openBlobTab("<!doctype html><p>Deck</p>", "text/html", "print");
    expect(tabsCreate).toHaveBeenCalledWith({ url: `${BLOB_URL}#print` });
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe("text/html");
    expect(await bytesOf(blobs[0]!)).toEqual(Array.from(new TextEncoder().encode("<!doctype html><p>Deck</p>")));
  });

  it("9.3c openBlobTab without a fragment opens the bare blob URL", async () => {
    await openBlobTab("plain", "text/plain");
    expect(tabsCreate).toHaveBeenCalledWith({ url: BLOB_URL });
  });

  it("9.3c openBlobTab revokes its URL after 60 s and not before", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    await openBlobTab("<p>Deck</p>", "text/html", "print");
    jest.advanceTimersByTime(59_000);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });
});
