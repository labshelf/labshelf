import { createLoopbackTransport } from "../../../src/library-ui/protocol/loopbackTransport";
import type { UiToHost } from "../../../src/library-ui/protocol";

describe("createLoopbackTransport", () => {
  it("delivers a UI message to the host before post returns", () => {
    const { ui, host } = createLoopbackTransport();
    const seen: UiToHost[] = [];
    host.subscribe((m) => seen.push(m));
    ui.post({ type: "paper.attachPdf", id: "p1" });
    expect(seen).toEqual([{ type: "paper.attachPdf", id: "p1" }]);
  });

  it("delivers host messages to the UI and stops after unsubscribe", () => {
    const { ui, host } = createLoopbackTransport();
    const seen: string[] = [];
    const off = ui.subscribe((m) => seen.push(m.type));
    host.post({ type: "select", id: "a" });
    off();
    host.post({ type: "select", id: "b" });
    expect(seen).toEqual(["select"]);
  });

  it("keeps messages posted before the other side listens, in order", () => {
    const { ui, host } = createLoopbackTransport();
    ui.post({ type: "ready" });
    ui.post({ type: "navigate", folder: "papers/A" });
    const seen: string[] = [];
    host.subscribe((m) => seen.push(m.type));
    expect(seen).toEqual(["ready", "navigate"]);
  });
});
