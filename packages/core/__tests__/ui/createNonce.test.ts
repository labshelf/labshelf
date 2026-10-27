/**
 * Tests that createNonce returns a CSP-valid base64 nonce carrying 128 random bits.
 */
import { createNonce } from "../../src/ui/htmlSafety";

describe("createNonce", () => {
  it("returns base64 that decodes to 16 bytes", () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(nonce)).toHaveLength(16);
  });

  it("returns a different value on every call", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});
