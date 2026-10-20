/** Pins that a restarted device puts the edits the relay lacks from an earlier process, and puts nothing when the relay lacks none. */
import * as Y from "yjs";
import { memoryCursorStore, type RelayCursorStore } from "../../../../src/collab/sync/index";
import { FakeClock, runUntil } from "../fakeNetwork";
import { FakeRelay, runFor } from "../../transport/relay/fakeRelay";
import { DOC_PATH, openRelayClient } from "../../transport/relay/relayClient";

/** Restores a doc as a fresh process does from the device's stored state. */
const restored = (doc: Y.Doc): Y.Doc => { const copy = new Y.Doc(); Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc)); return copy; };

describe("relay sync across a restart", () => {
  let clock: FakeClock;
  let relay: FakeRelay;
  let cursors: RelayCursorStore;
  let stored: Y.Doc;

  beforeEach(async () => {
    clock = new FakeClock();
    relay = new FakeRelay(clock);
    cursors = memoryCursorStore();
    stored = new Y.Doc();
    const first = await openRelayClient(relay, clock, [stored], cursors);
    await runFor(clock, 1000);
    first.text().insert(0, "shared ");
    await runFor(clock, 3000);
    await first.close();
    expect(relay.counts.put).toBe(1);
  });

  it("puts edits made without a relay connection in an earlier process", async () => {
    stored.getText("body").insert(7, "offline ");
    const restarted = await openRelayClient(relay, clock, [restored(stored)], cursors);
    await runFor(clock, 3000);
    await restarted.close();

    const fresh = await openRelayClient(relay, clock);
    expect(await runUntil(clock, () => fresh.text().toString() === "shared offline ", 10_000)).toBe(true);
    await fresh.close();
  });

  it("puts nothing on a restart when the relay holds every local edit", async () => {
    const restarted = await openRelayClient(relay, clock, [restored(stored)], cursors);
    await runFor(clock, 3000);
    await restarted.close();
    expect(relay.counts.put).toBe(1);
  });

  it("puts a delete made without a relay connection, which adds no clock", async () => {
    stored.getText("body").delete(0, 1);
    const restarted = await openRelayClient(relay, clock, [restored(stored)], cursors);
    await runFor(clock, 3000);
    await restarted.close();

    const fresh = await openRelayClient(relay, clock);
    expect(await runUntil(clock, () => fresh.text().toString() === "hared ", 10_000)).toBe(true);
    await fresh.close();
  });

  it("catches up from the first row once when a cursor has no held state, then holds everything", async () => {
    const key = DOC_PATH;
    const withoutHeld = memoryCursorStore();
    withoutHeld.set(key, 5);
    const restarted = await openRelayClient(relay, clock, [restored(stored)], withoutHeld);
    await runFor(clock, 3000);
    expect(restarted.text().toString()).toBe("shared ");
    await restarted.close();
    expect(withoutHeld.held(key)).toBeDefined();
    expect(relay.counts.put).toBe(1);
    const fresh = await openRelayClient(relay, clock);
    expect(await runUntil(clock, () => fresh.text().toString() === "shared ", 10_000)).toBe(true);
    await fresh.close();
  });

  it("only puts when the held state lags the relay", async () => {
    const lagging = memoryCursorStore();
    lagging.set(DOC_PATH, 0);
    lagging.setHeld(DOC_PATH, Y.encodeSnapshot(Y.snapshot(new Y.Doc())));
    const restarted = await openRelayClient(relay, clock, [restored(stored)], lagging);
    await runFor(clock, 3000);
    expect(restarted.text().toString()).toBe("shared ");
    await restarted.close();

    const fresh = await openRelayClient(relay, clock);
    expect(await runUntil(clock, () => fresh.text().toString() === "shared ", 10_000)).toBe(true);
    await fresh.close();
  });
});
