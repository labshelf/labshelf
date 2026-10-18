/** Pins the share link: round trip through the page URL, and typed refusal of malformed links. */
import { formatShareLink, parseShareLink, SHARE_PAGE_ORIGIN } from "../../../src/share/index";

const shareId = "0123456789abcdef0123456789abcdef";
const key = new Uint8Array(16).map((_, index) => index * 17);
const relayUrl = "https://labshelf-relay.someone.workers.dev";

describe("share link", () => {
  it("round trips the Worker host, share id and key through the fragment", () => {
    const link = formatShareLink({ relayUrl, shareId, key });
    expect(link.startsWith(`${SHARE_PAGE_ORIGIN}/share/#labshelf-relay.someone.workers.dev/${shareId}/`)).toBe(true);
    const parsed = parseShareLink(link);
    expect(parsed).toEqual({ ok: true, link: { relayUrl, shareId, key } });
  });

  it("reads a fragment whose slashes an opener percent-encoded", () => {
    const link = formatShareLink({ relayUrl, shareId, key });
    const [page, fragment] = link.split("#") as [string, string];
    expect(parseShareLink(`${page}#${fragment.replaceAll("/", "%2F")}`)).toEqual({ ok: true, link: { relayUrl, shareId, key } });
    expect(parseShareLink(`${page}#%E0%A4%A`).ok).toBe(false);
  });

  it("accepts the page on any origin whose path ends in /share/", () => {
    const link = formatShareLink({ relayUrl, shareId, key }).replace(SHARE_PAGE_ORIGIN, "http://localhost:8080/site");
    expect(parseShareLink(link).ok).toBe(true);
  });

  it.each([
    ["not a URL", "notShareLink"],
    [`${SHARE_PAGE_ORIGIN}/other/#a.dev/${shareId}/AAAAAAAAAAAAAAAAAAAAAA`, "notShareLink"],
    [`${SHARE_PAGE_ORIGIN}/share/`, "notShareLink"],
    [`${SHARE_PAGE_ORIGIN}/share/#a.dev/${shareId}`, "notShareLink"],
    [`${SHARE_PAGE_ORIGIN}/share/#a.dev/${shareId}/AAAAAAAAAAAAAAAAAAAAAA/extra`, "notShareLink"],
    [`${SHARE_PAGE_ORIGIN}/share/#bad_host!/${shareId}/AAAAAAAAAAAAAAAAAAAAAA`, "badHost"],
    [`${SHARE_PAGE_ORIGIN}/share/#a.dev:8787/${shareId}/AAAAAAAAAAAAAAAAAAAAAA`, "badHost"],
    [`${SHARE_PAGE_ORIGIN}/share/#a.dev/0123/AAAAAAAAAAAAAAAAAAAAAA`, "badShareId"],
    [`${SHARE_PAGE_ORIGIN}/share/#a.dev/${shareId.toUpperCase()}/AAAAAAAAAAAAAAAAAAAAAA`, "badShareId"],
    [`${SHARE_PAGE_ORIGIN}/share/#a.dev/${shareId}/AAAA`, "badKey"],
    [`${SHARE_PAGE_ORIGIN}/share/#a.dev/${shareId}/AAAAAAAAAAAAAAAAAAAAA+`, "badKey"],
  ])("refuses %s as %s without throwing", (text, error) => {
    expect(parseShareLink(text)).toEqual({ ok: false, error });
  });
});
