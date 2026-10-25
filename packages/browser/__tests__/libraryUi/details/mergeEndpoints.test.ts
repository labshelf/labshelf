import { createLoopbackTransport } from "@labshelf/core";
import { mergeEndpoints } from "../../../src/libraryUi/details";

describe("mergeEndpoints", () => {
  it("posts to both ends and listens on both", () => {
    const a = createLoopbackTransport();
    const b = createLoopbackTransport();
    const merged = mergeEndpoints(a.host, b.host);
    const fromA: unknown[] = [];
    const fromB: unknown[] = [];
    a.ui.subscribe((m) => fromA.push(m));
    b.ui.subscribe((m) => fromB.push(m));
    merged.post({ type: "select", id: "p1" });
    expect(fromA).toEqual([{ type: "select", id: "p1" }]);
    expect(fromB).toEqual([{ type: "select", id: "p1" }]);

    const heard: unknown[] = [];
    const stop = merged.subscribe((m) => heard.push(m));
    a.ui.post({ type: "ready" });
    b.ui.post({ type: "paper.selected", ids: ["p1"] });
    expect(heard).toEqual([{ type: "ready" }, { type: "paper.selected", ids: ["p1"] }]);
    stop();
    a.ui.post({ type: "ready" });
    expect(heard).toHaveLength(2);
  });
});
