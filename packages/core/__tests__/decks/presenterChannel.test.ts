/**
 * Spec 7.1: the presenter channel. parsePresenterMessage keeps only the four message shapes, and createBroadcastPresenterChannel
 * posts and receives through a BroadcastChannel made by the factory it is given. The factory returns a fake: no real BroadcastChannel.
 * The fake delivers a message both to its onmessage handler and to its "message" event listeners, so either wiring works.
 */
import { createBroadcastPresenterChannel, parsePresenterMessage, type PresenterMessage } from "../../src/decks/presenterChannel";

const STATE = { slide: 1, count: 3, black: false, startedAt: 1000, pausedAt: null, pausedTotal: 0 };

class FakeBroadcastChannel extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly postMessage = jest.fn<void, [unknown]>();
  readonly close = jest.fn<void, []>();
  constructor(readonly name: string) {
    super();
  }
  /** Delivers data as a message from another context. */
  deliver(data: unknown): void {
    const event = new MessageEvent("message", { data });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }
}

function fakeFactory() {
  const made: FakeBroadcastChannel[] = [];
  const factory = jest.fn((name: string) => {
    const channel = new FakeBroadcastChannel(name);
    made.push(channel);
    return channel as unknown as BroadcastChannel;
  });
  return { factory, made };
}

// --- 7.1c ---------------------------------------------------------------------------------------------------------------------------

describe("parsePresenterMessage", () => {
  it("7.1c accepts hello and exit", () => {
    expect(parsePresenterMessage({ type: "hello" })).toEqual({ type: "hello" });
    expect(parsePresenterMessage({ type: "exit" })).toEqual({ type: "exit" });
  });

  it("7.1c accepts an action of each known kind", () => {
    for (const kind of ["next", "previous", "first", "last", "toggleBlack", "pauseTimer", "resumeTimer", "resetTimer"]) {
      expect(parsePresenterMessage({ type: "action", action: { kind } })).toEqual({ type: "action", action: { kind } });
    }
    expect(parsePresenterMessage({ type: "action", action: { kind: "goto", slide: 2 } })).toEqual({ type: "action", action: { kind: "goto", slide: 2 } });
  });

  it("7.1c accepts a valid state, with numbers or null for the timer fields", () => {
    expect(parsePresenterMessage({ type: "state", state: STATE })).toEqual({ type: "state", state: STATE });
    const paused = { ...STATE, black: true, pausedAt: 4000, pausedTotal: 250 };
    expect(parsePresenterMessage({ type: "state", state: paused })).toEqual({ type: "state", state: paused });
    const fresh = { slide: 0, count: 1, black: false, startedAt: null, pausedAt: null, pausedTotal: 0 };
    expect(parsePresenterMessage({ type: "state", state: fresh })).toEqual({ type: "state", state: fresh });
  });

  it("7.1c drops unknown keys", () => {
    expect(parsePresenterMessage({ type: "hello", from: "x" })).toEqual({ type: "hello" });
    expect(parsePresenterMessage({ type: "state", state: { ...STATE, extra: 1 }, other: true })).toEqual({ type: "state", state: STATE });
    expect(parsePresenterMessage({ type: "action", action: { kind: "next", by: 2 } })).toEqual({ type: "action", action: { kind: "next" } });
  });

  it("7.1c rejects values that are not one of the four shapes", () => {
    for (const value of [null, undefined, "hello", 3, [], {}, { type: "other" }, { type: "HELLO" }, { kind: "next" }]) {
      expect(parsePresenterMessage(value)).toBeNull();
    }
  });

  it("7.1c rejects an action of an unknown kind or with a bad goto slide", () => {
    for (const action of [undefined, null, "next", {}, { kind: "jump" }, { kind: "goto" }, { kind: "goto", slide: "2" }]) {
      expect(parsePresenterMessage({ type: "action", action })).toBeNull();
    }
  });

  it("7.1c rejects a state with invalid fields", () => {
    const bad = [
      { ...STATE, slide: 1.5 },
      { ...STATE, slide: "1" },
      { ...STATE, count: 0 },
      { ...STATE, count: 2.5 },
      { ...STATE, black: "no" },
      { ...STATE, startedAt: "1000" },
      { ...STATE, pausedAt: false },
      { ...STATE, pausedTotal: null },
      { slide: 1, count: 3, black: false, startedAt: null, pausedAt: null },
    ];
    for (const state of bad) expect(parsePresenterMessage({ type: "state", state })).toBeNull();
    expect(parsePresenterMessage({ type: "state" })).toBeNull();
    expect(parsePresenterMessage({ type: "state", state: null })).toBeNull();
  });
});

describe("createBroadcastPresenterChannel", () => {
  it("7.1c opens a BroadcastChannel of the given name through the factory", () => {
    const { factory, made } = fakeFactory();
    createBroadcastPresenterChannel("deck-present-1", factory);
    expect(factory).toHaveBeenCalledWith("deck-present-1");
    expect(made).toHaveLength(1);
  });

  it("7.1c post sends the message through the BroadcastChannel", () => {
    const { factory, made } = fakeFactory();
    const channel = createBroadcastPresenterChannel("deck", factory);
    const message: PresenterMessage = { type: "action", action: { kind: "goto", slide: 2 } };
    channel.post(message);
    expect(made[0]!.postMessage).toHaveBeenCalledTimes(1);
    expect(made[0]!.postMessage.mock.calls[0]![0]).toEqual(message);
  });

  it("7.1c listeners get parsed messages only", () => {
    const { factory, made } = fakeFactory();
    const channel = createBroadcastPresenterChannel("deck", factory);
    const listener = jest.fn<void, [PresenterMessage]>();
    channel.onMessage(listener);
    made[0]!.deliver({ type: "state", state: { ...STATE, extra: 1 } });
    made[0]!.deliver({ type: "bogus" });
    made[0]!.deliver("hello");
    made[0]!.deliver({ type: "hello" });
    expect(listener.mock.calls.map(([m]) => m)).toEqual([{ type: "state", state: STATE }, { type: "hello" }]);
  });

  it("7.1c the function onMessage returns removes that listener", () => {
    const { factory, made } = fakeFactory();
    const channel = createBroadcastPresenterChannel("deck", factory);
    const kept = jest.fn();
    const removed = jest.fn();
    channel.onMessage(kept);
    const off = channel.onMessage(removed);
    off();
    made[0]!.deliver({ type: "exit" });
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it("7.1c close closes the BroadcastChannel and stops the listeners", () => {
    const { factory, made } = fakeFactory();
    const channel = createBroadcastPresenterChannel("deck", factory);
    const listener = jest.fn();
    channel.onMessage(listener);
    channel.close();
    expect(made[0]!.close).toHaveBeenCalled();
    made[0]!.deliver({ type: "hello" });
    expect(listener).not.toHaveBeenCalled();
  });
});
