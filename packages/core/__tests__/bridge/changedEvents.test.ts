/** Pins that change batches split into events whose frames stay under the host message limit. */
import { changedEvents } from "../../src/bridge/changedEvents";
import { encodeFrame, HOST_MESSAGE_LIMIT } from "../../src/bridge/index";

describe("changedEvents", () => {
  it("returns no event for no paths", () => {
    expect(changedEvents([])).toEqual([]);
  });

  it("keeps a small batch in one event", () => {
    expect(changedEvents(["papers/a/metadata.yaml", "papers/ä/b.pdf"])).toEqual([
      { event: "changed", paths: ["papers/a/metadata.yaml", "papers/ä/b.pdf"] },
    ]);
  });

  it("splits a batch too large for one frame, keeping every path in order", () => {
    const paths = Array.from({ length: 25_000 }, (_, index) => `papers/ü-${String(index).padStart(6, "0")}-${"x".repeat(40)}/metadata.yaml`);
    const events = changedEvents(paths);
    expect(events.length).toBeGreaterThan(1);
    for (const event of events) {
      expect(() => encodeFrame(event)).not.toThrow();
      expect(encodeFrame(event).length - 4).toBeLessThanOrEqual(HOST_MESSAGE_LIMIT);
    }
    expect(events.flatMap((event) => event.paths)).toEqual(paths);
  });
});
