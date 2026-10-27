/** Pins how share connections pick relays: past a failing first relay, around a relay refusing new sockets, one snapshot writer. */
import { readFileText } from "../../../src/collab/doc/index";
import { ONE, TWO } from "../relays/relayGroup";
import { runFor } from "../transport/relay/fakeRelay";
import { FOLDER, Network, newDevice, writeProject } from "./connectionTestbed";

const BOTH = [ONE, TWO];

async function owner(net: Network) {
  const ada = newDevice();
  await writeProject(ada);
  const connection = await net.connect(ada, { mode: "share", folder: FOLDER }, { relays: BOTH });
  await net.drive(connection.mirror!.idle());
  return { ada, connection };
}

async function join(net: Network) {
  const grace = newDevice();
  const connection = await net.drive(net.connect(grace, { mode: "join", signal: new AbortController().signal }, { relays: BOTH }));
  await net.drive(connection.mirror!.idle());
  return { grace, connection };
}

describe("share connection relays", () => {
  it("connects through the second relay when the first one fails", async () => {
    const net = new Network();
    net.hosts.set(ONE, "limit");
    const { connection: a } = await owner(net);
    await runFor(net.clock, 10_000);
    const { grace, connection: b } = await join(net);

    expect([a.state().relay, b.state().relay]).toEqual([TWO, TWO]);
    expect(grace.read(`${b.folder}/main.typ`)).toBe("= Hello\n");
    await net.drive(b.close());
    await net.drive(a.close());
  }, 60_000);

  it("brings in a member whose fresh socket the first relay refuses while the group stays connected there", async () => {
    const net = new Network();
    const { connection: a } = await owner(net);
    await runFor(net.clock, 5000);
    expect(a.state().relay).toBe(ONE);
    net.hosts.set(ONE, "refuseNew");
    readFileText(a.session.openDoc("main.typ")).insert(0, "Late ");
    const { grace, connection: b } = await join(net);
    await runFor(net.clock, 30_000);

    expect(b.state().relay).toBe(TWO);
    expect(readFileText(b.session.openDoc("main.typ")).toString()).toBe("Late = Hello\n");
    await net.drive(b.mirror!.idle());
    expect(grace.read(`${b.folder}/main.typ`)).toBe("Late = Hello\n");
    await net.drive(b.close());
    await net.drive(a.close());
  }, 60_000);

  it("elects exactly one connected member as the relay snapshot writer, and hands it over when that member leaves", async () => {
    const net = new Network();
    const { connection: a } = await owner(net);
    await runFor(net.clock, 5000);
    const { connection: b } = await join(net);
    await runFor(net.clock, 5000);
    const writers = [a, b].filter((each) => each.presence.isLowestId());
    expect(writers).toHaveLength(1);

    const [writer] = writers;
    const other = writer === a ? b : a;
    await net.drive(writer!.close());
    await runFor(net.clock, 5000);
    expect(other.presence.isLowestId()).toBe(true);
    await net.drive(other.close());
  }, 60_000);
});
