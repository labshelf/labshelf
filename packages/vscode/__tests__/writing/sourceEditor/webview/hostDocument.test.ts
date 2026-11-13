import { createHostDocument } from "../../../../src/writing/sourceEditor/webview/hostDocument";

const init = { text: "hello\nworld", lineBreak: "\n" as const, version: 3, dirty: false };
const update = { clientID: "c", changes: [[0, "x"]] } as never;

function listener() {
  return { updates: jest.fn(), resync: jest.fn(), dirty: jest.fn() };
}

describe("9.2 The VS Code source editor webview shows the consult footer and opens the chooser (hostDocument)", () => {
  it("9.2e createHostDocument starts the document from the init", () => {
    const { document } = createHostDocument(init, jest.fn());
    expect(document.text).toBe("hello\nworld");
    expect(document.lineBreak).toBe("\n");
    expect(document.version).toBe(3);
    expect(document.dirty).toBe(false);
  });

  it("9.2e createHostDocument posts push and save through the given post", () => {
    const post = jest.fn();
    const { document } = createHostDocument(init, post);
    document.push(3, [update]);
    document.save();
    expect(post).toHaveBeenNthCalledWith(1, { type: "push", version: 3, updates: [update] });
    expect(post).toHaveBeenNthCalledWith(2, { type: "save" });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("9.2e createHostDocument replays messages delivered before the first subscribe, in order, then delivers live ones", () => {
    const { document, deliver } = createHostDocument(init, jest.fn());
    deliver({ type: "updates", version: 4, updates: [update] });
    deliver({ type: "dirty", dirty: true });
    deliver({ type: "resync", text: "fresh", version: 9 });
    const calls: string[] = [];
    const l = {
      updates: jest.fn(() => { calls.push("updates"); }),
      dirty: jest.fn(() => { calls.push("dirty"); }),
      resync: jest.fn(() => { calls.push("resync"); }),
    };
    document.subscribe(l);
    expect(calls).toEqual(["updates", "dirty", "resync"]);
    expect(l.updates).toHaveBeenCalledWith(4, [update]);
    expect(l.dirty).toHaveBeenCalledWith(true);
    expect(l.resync).toHaveBeenCalledWith("fresh", 9);

    deliver({ type: "updates", version: 5, updates: [update] });
    expect(l.updates).toHaveBeenCalledTimes(2);
    expect(l.updates).toHaveBeenLastCalledWith(5, [update]);
  });

  it("9.2e createHostDocument replays the early messages only once", () => {
    const { document, deliver } = createHostDocument(init, jest.fn());
    deliver({ type: "dirty", dirty: true });
    const first = listener();
    const unsubscribe = document.subscribe(first);
    unsubscribe();
    const second = listener();
    document.subscribe(second);
    expect(first.dirty).toHaveBeenCalledTimes(1);
    expect(second.dirty).not.toHaveBeenCalled();
  });

  it("9.2e createHostDocument stops delivering to a listener once it unsubscribes", () => {
    const { document, deliver } = createHostDocument(init, jest.fn());
    const l = listener();
    const unsubscribe = document.subscribe(l);
    deliver({ type: "dirty", dirty: true });
    unsubscribe();
    deliver({ type: "dirty", dirty: false });
    expect(l.dirty).toHaveBeenCalledTimes(1);
  });

  it("9.2e createHostDocument delivers each live message to every subscribed listener", () => {
    const { document, deliver } = createHostDocument(init, jest.fn());
    const a = listener();
    const b = listener();
    document.subscribe(a);
    document.subscribe(b);
    deliver({ type: "resync", text: "t", version: 7 });
    expect(a.resync).toHaveBeenCalledWith("t", 7);
    expect(b.resync).toHaveBeenCalledWith("t", 7);
  });
});
