/** Pins that share sessions meeting only through a fake relay converge, catch a late client up and exchange presence. */
import { readShareIndexDocFiles, INDEX_DOC_KEY } from "../../../src/collab/doc/index";
import { CHANNEL_KIND } from "../../../src/collab/peer/index";
import { FakeClock, runUntil, seededRandom } from "../peer/fakeNetwork";
import { FakeRelay, runFor } from "../transport/relay/fakeRelay";
import { openRelayClient, type RelayClient } from "../transport/relay/relayClient";

const PATHS = ["main.tex", "intro.tex", "refs.tex"];

function snapshot(client: RelayClient): string {
  const docs = [...client.session.docs()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(docs.map(([key, doc]) => [key, Object.entries(doc.getMap("files").toJSON()).sort(), doc.getText("body").toString()]));
}

const converged = (clients: RelayClient[]) => clients.every((c) => snapshot(c) === snapshot(clients[0]!));

function randomEdits(clients: RelayClient[], random: () => number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const c = clients[Math.floor(random() * clients.length)]!;
    const path = PATHS[Math.floor(random() * PATHS.length)]!;
    readShareIndexDocFiles(c.session.index).set(path, { kind: "text" });
    if (random() < 0.3) { continue; }
    const body = c.session.openDoc(path).getText("body");
    body.insert(Math.floor(random() * (body.length + 1)), `${i} `);
  }
}

describe("share sessions over the relay", () => {
  let clock: FakeClock;
  let relay: FakeRelay;
  let clients: RelayClient[] = [];
  beforeEach(() => { clock = new FakeClock(); relay = new FakeRelay(clock); });
  afterEach(async () => { await Promise.all(clients.map((c) => c.close())); clients = []; });

  it("converges two clients typing into the same doc at once", async () => {
    clients = await Promise.all([openRelayClient(relay, clock), openRelayClient(relay, clock)]);
    await runFor(clock, 1000);
    const [a, b] = clients as [RelayClient, RelayClient];
    a.text().insert(0, "left ");
    b.text().insert(0, "right ");
    expect(await runUntil(clock, () => a.text().length === 11 && a.text().toString() === b.text().toString(), 20_000)).toBe(true);
    expect(a.text().toString()).toContain("left ");
    expect(a.text().toString()).toContain("right ");
  });

  it("converges three clients after random concurrent edits to the index and file docs", async () => {
    clients = await Promise.all([1, 2, 3].map(() => openRelayClient(relay, clock)));
    await runFor(clock, 1000);
    const random = seededRandom(3);
    for (let round = 0; round < 4; round += 1) {
      randomEdits(clients, random, 15);
      await runFor(clock, 700);
    }
    expect(await runUntil(clock, () => converged(clients) && clients.every((c) => c.session.docs().size === PATHS.length + 1), 30_000)).toBe(true);
    expect(clients[0]!.session.docs().has(INDEX_DOC_KEY)).toBe(true);
  }, 60_000);

  it("catches a late client up on what the others wrote, and delivers its own edit to them", async () => {
    clients = await Promise.all([openRelayClient(relay, clock), openRelayClient(relay, clock)]);
    await runFor(clock, 1000);
    randomEdits(clients, seededRandom(5), 30);
    expect(await runUntil(clock, () => converged(clients), 30_000)).toBe(true);
    const late = await openRelayClient(relay, clock);
    clients.push(late);
    expect(await runUntil(clock, () => converged(clients), 30_000)).toBe(true);
    late.text().insert(0, "late ");
    expect(await runUntil(clock, () => clients[0]!.text().toString().startsWith("late ") && converged(clients), 20_000)).toBe(true);
  }, 60_000);

  it("shows each client the cursor and presence of the others, forwarded and never stored", async () => {
    clients = await Promise.all([1, 2, 3].map(() => openRelayClient(relay, clock)));
    await runFor(clock, 1000);
    clients.forEach((c, i) => c.presence.setLocal({ name: "abc"[i]!, colour: "#000000", file: "main.tex", anchor: String(i), head: String(i) }));
    expect(await runUntil(clock, () => clients.every((c) => c.presence.remote().size === 2), 20_000)).toBe(true);
    for (const [i, c] of clients.entries()) {
      const seen = [...c.presence.remote().values()].map((state) => `${state.name}@${state.head}`).sort();
      expect(seen).toEqual(["a@0", "b@1", "c@2"].filter((_, j) => j !== i));
    }
    expect(relay.forwardKinds.get(CHANNEL_KIND.awareness)).toBeGreaterThan(0);
    expect(relay.counts.put).toBe(0);
  });
});
