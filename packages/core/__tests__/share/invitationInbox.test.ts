// Tests the invitation inbox: refresh, accept and decline of what arrives from another person.
import { generateIdentity, publicKeys, sealInvite } from "../../src/collab/index";
import { readMembers } from "../../src/collab/members";
import { bytesToBase64Url } from "../../src/encoding/index";
import { contactOf, newInvite, person, setup, type Person, type World } from "./invitationsFixture";

async function sendTo(world: World, alice: Person, bob: Person, title = "Paper") {
  alice.enabled = true;
  bob.enabled = true;
  await alice.contacts.write([await contactOf(bob)]);
  const invite = await newInvite();
  await alice.invitations.inviteByEmail({ link: invite.link, title, email: bob.email });
  world.clock += 61_000;
  const [view] = await bob.invitations.refreshInvitations();
  return { invite, view: view! };
}

describe("the inbox", () => {
  it("accepts by joining from the decoded invite, storing the key after connecting, and deleting the entry", async () => {
    const { world, alice, bob } = await setup();
    const { invite, view } = await sendTo(world, alice, bob);
    const changes: unknown[] = [];
    bob.invitations.onInvitationsChange((list) => changes.push(list));
    const outcome = await bob.invitations.acceptInvitation(view.id, new AbortController().signal);
    expect(outcome).toEqual({ kind: "joined", folder: `projects/${invite.shareId.slice(0, 6)}` });
    expect(bob.connected.map((i) => i.shareId)).toEqual([invite.shareId]);
    expect(bob.order).toEqual(["connect", "add", "remember"]);
    expect(world.inboxes.get(bob.account.relayUrl)?.items).toEqual([]);
    expect(changes).toEqual([[]]);
    const index = bob.open.get(invite.shareId)!.session.index;
    expect((await readMembers(index)).map((m) => m.fingerprint)).toEqual([bob.fingerprint]);
  });

  it("declines by deleting only", async () => {
    const { world, alice, bob } = await setup();
    const { view } = await sendTo(world, alice, bob);
    await bob.invitations.declineInvitation(view.id);
    expect(bob.connected).toEqual([]);
    expect(world.inboxes.get(bob.account.relayUrl)?.items).toEqual([]);
    await expect(bob.invitations.invitations()).resolves.toEqual([]);
  });

  it("drops an envelope that does not open", async () => {
    const { world, bob } = await setup();
    bob.enabled = true;
    const stranger = await generateIdentity();
    const sealed = await sealInvite({
      sender: stranger, card: { ...(await publicKeys(stranger)) }, recipient: { encryptionKey: (await publicKeys(stranger)).encryptionKey, fingerprint: bob.fingerprint },
      link: (await newInvite()).link, title: "Spoof", now: world.clock,
    });
    world.inboxes.get(bob.account.relayUrl)!.items.push({ id: bytesToBase64Url(new Uint8Array(32).fill(7)), sealed: { ...sealed }, from: bob.fingerprint, received: 1 });
    await expect(bob.invitations.refreshInvitations()).resolves.toEqual([]);
    expect(world.inboxes.get(bob.account.relayUrl)?.items).toEqual([]);
  });

  it("reads the inbox at most once a minute and is empty while off", async () => {
    const { world, alice, bob } = await setup();
    await sendTo(world, alice, bob);
    const reads = () => world.seen.filter((s) => s.method === "GET").length;
    const before = reads();
    await bob.invitations.refreshInvitations();
    await bob.invitations.invitations();
    expect(reads()).toBe(before);
    world.clock += 61_000;
    await bob.invitations.refreshInvitations();
    expect(reads()).toBe(before + 1);
    const off = await person(world, "dave", { invitations: false });
    await expect(off.invitations.invitations()).resolves.toEqual([]);
  });
});
