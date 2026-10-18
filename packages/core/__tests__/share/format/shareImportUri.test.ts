/** Verifies that the Open in LabShelf URI carries the share link, percent-encoded, to the extension's importShare path. */
import { formatShareImportUri, formatShareLink, parseShareLink } from "../../../src/share/index";

describe("formatShareImportUri", () => {
  it("names the extension and the importShare path, and its link query parses back to the share", () => {
    const link = { relayUrl: "https://labshelf-relay.me.workers.dev", shareId: "a".repeat(32), key: new Uint8Array(16).fill(7) };
    const uri = new URL(formatShareImportUri(link));
    expect(`${uri.protocol}//${uri.host}${uri.pathname}`).toBe("vscode://labshelf.labshelf/importShare");
    const text = uri.searchParams.get("link");
    expect(text).toBe(formatShareLink(link));
    const parsed = parseShareLink(text!);
    expect(parsed.ok && parsed.link.shareId).toBe(link.shareId);
  });
});
