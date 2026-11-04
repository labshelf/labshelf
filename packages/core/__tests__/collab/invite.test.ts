/** Pins the short invite: format/parse round trip with zero, one and two relays, and one typed error per malformed part. */
import { bytesToBase64Url } from "../../src/encoding/index";
import { assertInviteHasRelay, deriveShareId, formatInvite, InviteWithoutRelayError, parseInvite } from "../../src/collab/index";

const shareKey = Uint8Array.from({ length: 16 }, (_, index) => index * 17 + 3);
const keyText = bytesToBase64Url(shareKey);
const workerA = "https://ls-abcdefghijkl.someone.workers.dev";
const workerB = "https://ls-mnopqrstuvwx.other.workers.dev";

describe("invite", () => {
  it("1.1g writes one ls- relay as v1.<key>.<name>.<subdomain>", async () => {
    expect(keyText).toHaveLength(22);
    expect(await formatInvite({ shareKey, relays: [{ url: workerA }] })).toBe(`labshelf://join#v1.${keyText}.abcdefghijkl.someone`);
  });

  it("1.1g joins two relays with ~", async () => {
    expect(await formatInvite({ shareKey, relays: [{ url: workerA }, { url: workerB }] })).toBe(
      `labshelf://join#v1.${keyText}.abcdefghijkl.someone~mnopqrstuvwx.other`,
    );
  });

  it("1.1g ends right after the key when there are no relays", async () => {
    expect(await formatInvite({ shareKey, relays: [] })).toBe(`labshelf://join#v1.${keyText}`);
  });

  it.each([
    ["no relay", []],
    ["one relay", [{ url: workerA }]],
    ["two relays", [{ url: workerA }, { url: "https://relay.example:8443" }]],
  ])("1.1g round trips %s", async (_label, relays) => {
    const text = await formatInvite({ shareKey, relays });
    expect(await parseInvite(text)).toEqual({ ok: true, invite: { shareId: await deriveShareId(shareKey), shareKey, relays } });
  });

  it.each([
    ["no relay", []],
    ["one relay", [{ url: workerA }]],
    ["two relays", [{ url: workerA }, { url: workerB }]],
  ])("1.1g reads %s from a sentence ending in a full stop", async (_label, relays) => {
    const text = await formatInvite({ shareKey, relays });
    const parsed = await parseInvite(`Join my share: ${text}.`);
    expect(parsed).toEqual({ ok: true, invite: { shareId: await deriveShareId(shareKey), shareKey, relays } });
  });

  it("1.1g reads the invite inside pasted text with other punctuation around it", async () => {
    const text = await formatInvite({ shareKey, relays: [{ url: workerA }] });
    const parsed = await parseInvite(`  Join (${text}), please\n`);
    expect(parsed).toEqual({ ok: true, invite: { shareId: await deriveShareId(shareKey), shareKey, relays: [{ url: workerA }] } });
  });

  it.each([
    ["plain text", "hello"],
    ["the scheme without a fragment", "labshelf://join"],
    ["an empty fragment", "labshelf://join#"],
    ["another scheme", `labshelf://open#v1.${keyText}`],
    ["a fragment that is not a version", `labshelf://join#garbage.${keyText}`],
  ])("1.1h refuses %s as notAnInvite", async (_label, text) => {
    expect(await parseInvite(text)).toEqual({ ok: false, error: "notAnInvite" });
  });

  it("1.1h refuses version 2 as unsupportedVersion", async () => {
    expect(await parseInvite(`labshelf://join#v2.${keyText}.abcdefghijkl.someone`)).toEqual({ ok: false, error: "unsupportedVersion" });
  });

  it.each([
    ["missing", "labshelf://join#v1"],
    ["empty", "labshelf://join#v1."],
    ["short", `labshelf://join#v1.${bytesToBase64Url(new Uint8Array(15))}.abcdefghijkl.someone`],
    ["long", `labshelf://join#v1.${bytesToBase64Url(new Uint8Array(17))}.abcdefghijkl.someone`],
    ["outside base64url", "labshelf://join#v1.AAAAAAAAAAAAAAAAAAAA+/.abcdefghijkl.someone"],
  ])("1.1h refuses a %s key as badKey", async (_label, text) => {
    expect(await parseInvite(text)).toEqual({ ok: false, error: "badKey" });
  });

  it.each([
    ["a path entry", `labshelf://join#v1.${keyText}.a/b`],
    ["an empty entry between ~", `labshelf://join#v1.${keyText}.abcdefghijkl.someone~~relay.example`],
    ["an empty leading entry", `labshelf://join#v1.${keyText}.~relay.example`],
    ["an upper-case entry", `labshelf://join#v1.${keyText}.Upper.Case`],
    ["one bad entry after a good one", `labshelf://join#v1.${keyText}.abcdefghijkl.someone~a/b`],
  ])("1.1h refuses %s as badRelayList", async (_label, text) => {
    expect(await parseInvite(text)).toEqual({ ok: false, error: "badRelayList" });
  });

  it("1.1h derives the parsed share id from the key", async () => {
    const parsed = await parseInvite(`labshelf://join#v1.${keyText}.abcdefghijkl.someone`);
    expect(parsed.ok && parsed.invite.shareId).toBe(await deriveShareId(shareKey));
    expect(parsed.ok && parsed.invite.shareId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("1.1h keeps refusing an invite without a relay with a typed error", async () => {
    const shareId = await deriveShareId(shareKey);
    expect(() => assertInviteHasRelay({ shareId, shareKey, relays: [] })).toThrow(InviteWithoutRelayError);
    expect(() => assertInviteHasRelay({ shareId, shareKey, relays: [{ url: workerA }] })).not.toThrow();
  });
});
