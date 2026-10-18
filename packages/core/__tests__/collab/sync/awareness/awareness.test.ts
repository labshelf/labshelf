/** Pins that cursors reach the other peers of a share, leave with their peer and are never trusted blindly. */
import { attachAwareness, CHANNEL_KIND, type PresenceHandle, type PresenceState } from "../../../../src/collab/sync/index";
import { FakeClock, FakeNetwork, runUntil } from "../fakeNetwork";
import { awarenessKey, openSession, type TestClient } from "../testSession";

const state = (name: string, anchor: string | null = null): PresenceState => ({ name, colour: "#ff0000", file: "main.typ", anchor, head: anchor });

describe("awareness", () => {
  let clock: FakeClock;
  let net: FakeNetwork;
  let clients: TestClient[] = [];
  let handles: PresenceHandle[] = [];
  beforeEach(() => { clock = new FakeClock(); net = new FakeNetwork(clock); });
  afterEach(async () => {
    await Promise.all(handles.map((h) => h.close()));
    await Promise.all(clients.map((c) => c.session.close()));
    clients = [];
    handles = [];
  });

  async function attach(id: string): Promise<PresenceHandle> {
    const client = await openSession(net, clock, id);
    const handle = attachAwareness(client.session, { awarenessKey: await awarenessKey(), logger: client.logger });
    clients.push(client);
    handles.push(handle);
    return handle;
  }
  const names = (handle: PresenceHandle) => [...handle.remote().values()].map((s) => s.name).sort();

  it("uses kind 16 for awareness", () => { expect(CHANNEL_KIND.awareness).toBe(16); });

  it("shows a peer's cursor to the others and follows it", async () => {
    const [a, b] = [await attach("a"), await attach("b")];
    a.setLocal(state("Ada", "cursor-1"));
    expect(await runUntil(clock, () => names(b).length === 1)).toBe(true);
    expect([...b.remote().values()][0]).toEqual(state("Ada", "cursor-1"));
    a.setLocal(state("Ada", "cursor-2"));
    expect(await runUntil(clock, () => [...b.remote().values()][0]?.anchor === "cursor-2")).toBe(true);
    expect(names(a)).toEqual([]);
  });

  it("sends the full state to a peer that joins later", async () => {
    const a = await attach("a");
    a.setLocal(state("Ada"));
    const b = await attach("b");
    expect(await runUntil(clock, () => names(b).length === 1)).toBe(true);
  });

  it("removes a peer's cursor when the peer leaves and shows it again when it returns", async () => {
    const [a, b, c] = [await attach("a"), await attach("b"), await attach("c")];
    a.setLocal(state("Ada"));
    c.setLocal(state("Cy"));
    expect(await runUntil(clock, () => names(b).length === 2)).toBe(true);
    net.disconnect("a");
    expect(await runUntil(clock, () => names(b).length === 1 && names(c).length === 0)).toBe(true);
    expect(names(b)).toEqual(["Cy"]);
    net.reconnect("a");
    expect(await runUntil(clock, () => names(b).length === 2 && names(c).length === 1)).toBe(true);
  });

  it("removes a peer's cursor when it closes its awareness", async () => {
    const [a, b] = [await attach("a"), await attach("b")];
    a.setLocal(state("Ada"));
    expect(await runUntil(clock, () => names(b).length === 1)).toBe(true);
    await a.close();
    expect(await runUntil(clock, () => names(b).length === 0)).toBe(true);
  });

  it("hides remote states that do not have the presence shape", async () => {
    const [a, b] = [await attach("a"), await attach("b")];
    (a.awareness as { setLocalState(s: unknown): void }).setLocalState({ name: 5, colour: [] });
    expect(await runUntil(clock, () => b.awareness.getStates().size === 1)).toBe(true);
    expect(b.remote().size).toBe(0);
  });

  it("logs and survives a payload that is not an awareness update", async () => {
    const b = await attach("b");
    const rogue = await openSession(net, clock, "rogue");
    clients.push(rogue);
    const channel = rogue.session.channel({ kind: CHANNEL_KIND.awareness, name: "awareness", key: await awarenessKey(), reliable: false, onMessage: () => {} });
    await channel.send("all", "/awareness", new Uint8Array([255, 255, 255, 255, 7]));
    const warned = () => clients[0]!.logger.log.mock.calls.some(([level]) => level === "WARN");
    expect(await runUntil(clock, warned)).toBe(true);
    expect(b.remote().size).toBe(0);
  });
});
