/** Pins the invite link: format/parse round trip and one typed error per malformed part. */
import { bytesToBase64Url } from "../../../src/encoding/index";
import { deriveShareId, generateShareKey } from "../../../src/collab/shareKey/index";
import { assertInviteHasRelay, formatInvite, InviteWithoutRelayError, parseInvite } from "../../../src/collab/invite/index";

const encodeRelays = (value: unknown): string => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));

async function parts(relays: unknown = []): Promise<string[]> {
  const shareKey = new Uint8Array(16).fill(5);
  return ["v1", await deriveShareId(shareKey), bytesToBase64Url(shareKey), encodeRelays(relays)];
}
const link = (segments: string[]): string => `labshelf://join#${segments.join(".")}`;

describe("invite", () => {
  it("round-trips the key and relays", async () => {
    const shareKey = generateShareKey();
    const relays = [{ url: "https://relay.example.com/" }, { url: "https://r2.example.com", relayToken: "abc_-" }];
    const text = await formatInvite({ shareKey, relays });
    expect(text).toMatch(/^labshelf:\/\/join#v1\.[0-9a-f]{32}\./);
    expect(await parseInvite(text)).toEqual({
      ok: true,
      invite: { shareId: await deriveShareId(shareKey), shareKey, relays },
    });
  });

  it("round-trips an empty relay list and accepts the link inside pasted text", async () => {
    const shareKey = generateShareKey();
    const text = await formatInvite({ shareKey, relays: [] });
    const parsed = await parseInvite(`  Join my share: ${text}\n`);
    expect(parsed).toEqual({ ok: true, invite: { shareId: await deriveShareId(shareKey), shareKey, relays: [] } });
  });

  it("accepts a link followed by sentence punctuation", async () => {
    const text = await formatInvite({ shareKey: generateShareKey(), relays: [] });
    expect((await parseInvite(`Join (${text}).`)).ok).toBe(true);
  });

  it("rejects text that is not an invite", async () => {
    expect(await parseInvite("hello")).toEqual({ ok: false, error: "notAnInvite" });
    expect(await parseInvite("labshelf://join#")).toEqual({ ok: false, error: "notAnInvite" });
    expect(await parseInvite(link((await parts()).slice(0, 3)))).toEqual({ ok: false, error: "notAnInvite" });
  });

  it("rejects an unsupported version", async () => {
    const segments = await parts();
    segments[0] = "v2";
    expect(await parseInvite(link(segments))).toEqual({ ok: false, error: "unsupportedVersion" });
  });

  it.each([["uppercase", "A".repeat(32)], ["short", "ab"], ["non-hex", "z".repeat(32)]])(
    "rejects a %s share id",
    async (_label, shareId) => {
      const segments = await parts();
      segments[1] = shareId;
      expect(await parseInvite(link(segments))).toEqual({ ok: false, error: "badShareId" });
    },
  );

  it.each([["wrong length", bytesToBase64Url(new Uint8Array(15))], ["invalid base64url", "AA=="]])(
    "rejects a key of %s",
    async (_label, key) => {
      const segments = await parts();
      segments[2] = key;
      expect(await parseInvite(link(segments))).toEqual({ ok: false, error: "badKey" });
    },
  );

  it.each([
    ["invalid base64url", "@@"],
    ["non-JSON", bytesToBase64Url(new TextEncoder().encode("{"))],
    ["a non-array", encodeRelays({ url: "https://a.example" })],
    ["a non-https url", encodeRelays([{ url: "http://a.example" }])],
    ["an unparsable url", encodeRelays([{ url: "not a url" }])],
    ["a non-string token", encodeRelays([{ url: "https://a.example", relayToken: 1 }])],
    ["an unknown field", encodeRelays([{ url: "https://a.example", extra: true }])],
  ])("rejects a relay list with %s", async (_label, relays) => {
    const segments = await parts();
    segments[3] = relays;
    expect(await parseInvite(link(segments))).toEqual({ ok: false, error: "badRelayList" });
  });

  it("rejects a share id that the key does not derive", async () => {
    const segments = await parts();
    segments[1] = "0".repeat(32);
    expect(await parseInvite(link(segments))).toEqual({ ok: false, error: "shareIdMismatch" });
  });

  it("refuses an invite without a relay with a typed error", async () => {
    const shareKey = generateShareKey();
    const shareId = await deriveShareId(shareKey);
    expect(() => assertInviteHasRelay({ shareId, shareKey, relays: [] })).toThrow(InviteWithoutRelayError);
    expect(() => assertInviteHasRelay({ shareId, shareKey, relays: [{ url: "https://relay.example.com/" }] })).not.toThrow();
  });
});
