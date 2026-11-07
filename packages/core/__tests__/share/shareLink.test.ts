/** Pins the short share link: round trip through the page URL, typed refusal of malformed links, and the share id derived from the key alone. */
import { bytesToBase64Url } from "../../src/encoding/index";
import { deriveShareId } from "../../src/shareKey/shareKey";
import { formatShareImportUri, formatShareLink, parseShareLink, resolveShareLink } from "../../src/share/shareLink";

const key = Uint8Array.from({ length: 16 }, (_, index) => index * 17);
const keyText = bytesToBase64Url(key);
const relayUrl = "https://ls-abcdefghijkl.someone.workers.dev";
const page = "https://labshelf.org/s/";

describe("share link", () => {
  it("1.1d writes an ls- Worker as the short fragment and reads the same relay URL and key back", () => {
    const link = formatShareLink({ relayUrl, key });
    expect(keyText).toHaveLength(22);
    expect(link).toBe(`${page}#abcdefghijkl.someone.${keyText}`);
    expect(parseShareLink(link)).toEqual({ ok: true, link: { relayUrl, key } });
  });

  it("1.1d round trips a whole-host relay", () => {
    const whole = "https://relay.example:8443";
    expect(parseShareLink(formatShareLink({ relayUrl: whole, key }))).toEqual({ ok: true, link: { relayUrl: whole, key } });
  });

  it("1.1d reads a fragment an opener percent-encoded", () => {
    const encoded = `${page}#${encodeURIComponent(`abcdefghijkl.someone.${keyText}`)}`;
    expect(parseShareLink(encoded)).toEqual({ ok: true, link: { relayUrl, key } });
    expect(parseShareLink(`${page}#abcdefghijkl.someone.${keyText.replace("-", "%2D")}`).ok).toBe(true);
  });

  it("1.1d accepts the page on any origin whose path is /s/", () => {
    expect(parseShareLink(`http://localhost:8080/s/#abcdefghijkl.someone.${keyText}`)).toEqual({ ok: true, link: { relayUrl, key } });
  });

  it("1.1d trims surrounding whitespace", () => {
    expect(parseShareLink(`  ${formatShareLink({ relayUrl, key })}\n`)).toEqual({ ok: true, link: { relayUrl, key } });
  });

  it("1.1e refuses the old /share/ path, a bad host and a bad key", () => {
    expect(parseShareLink(`https://labshelf.org/share/#abcdefghijkl.someone.${keyText}`)).toEqual({ ok: false, error: "notShareLink" });
    expect(parseShareLink(`${page}#Upper.Case.${keyText}`)).toEqual({ ok: false, error: "badHost" });
    expect(parseShareLink(`${page}#abcdefghijkl.someone.AAAA`)).toEqual({ ok: false, error: "badKey" });
  });

  it.each([
    ["not a URL", "not a url"],
    ["path /share/", `https://labshelf.org/share/#abcdefghijkl.someone.${keyText}`],
    ["path /other/", `https://labshelf.org/other/#abcdefghijkl.someone.${keyText}`],
    ["an empty fragment", `${page}#`],
    ["no fragment", page],
    ["a fragment without a dot", `${page}#abcdefghijklsomeone`],
    ["an empty host part", `${page}#.${keyText}`],
    ["an undecodable fragment", `${page}#%E0%A4%A`],
  ])("1.1e refuses %s as notShareLink without throwing", (_label, text) => {
    expect(parseShareLink(text)).toEqual({ ok: false, error: "notShareLink" });
  });

  it.each([
    ["an upper-case host", `${page}#Upper.Case.${keyText}`],
    ["a path in the host", `${page}#a/b.${keyText}`],
    ["a tilde in the host", `${page}#x~y.${keyText}`],
  ])("1.1e refuses %s as badHost", (_label, text) => {
    expect(parseShareLink(text)).toEqual({ ok: false, error: "badHost" });
  });

  it.each([
    ["a short key", bytesToBase64Url(new Uint8Array(15))],
    ["a long key", bytesToBase64Url(new Uint8Array(17))],
    ["an empty key", ""],
    ["characters outside base64url", "AAAAAAAAAAAAAAAAAAAA+/"],
    ["padding", "AAAAAAAAAAAAAAAAAAAAA="],
  ])("1.1e refuses %s as badKey", (_label, badKey) => {
    expect(parseShareLink(`${page}#abcdefghijkl.someone.${badKey}`)).toEqual({ ok: false, error: "badKey" });
  });
});

describe("resolveShareLink", () => {
  it("1.1f gives a 32-hex share id equal to deriveShareId(key)", async () => {
    const parts = await resolveShareLink({ relayUrl, key });
    expect(parts.shareId).toMatch(/^[0-9a-f]{32}$/);
    expect(parts.shareId).toBe(await deriveShareId(key));
    expect(parts.relayUrl).toBe(relayUrl);
    expect(parts.key).toEqual(key);
  });

  it("1.1f gives the same id for the same key and another id for another key", async () => {
    const other = new Uint8Array(16).fill(9);
    const first = await resolveShareLink({ relayUrl, key });
    const again = await resolveShareLink({ relayUrl: "https://relay.example", key: Uint8Array.from(key) });
    const different = await resolveShareLink({ relayUrl, key: other });
    expect(again.shareId).toBe(first.shareId);
    expect(different.shareId).not.toBe(first.shareId);
  });
});

describe("formatShareImportUri", () => {
  it("1.1d carries the percent-encoded short link to the extension's importShare path", () => {
    const link = { relayUrl, key };
    const uri = new URL(formatShareImportUri(link));
    expect(`${uri.protocol}//${uri.host}${uri.pathname}`).toBe("vscode://labshelf.labshelf/importShare");
    const text = uri.searchParams.get("link");
    expect(text).toBe(formatShareLink(link));
    expect(parseShareLink(text!)).toEqual({ ok: true, link });
  });
});
