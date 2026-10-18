/** Pins how relay protocol versions parse and when a client and a Worker are compatible. */
import { isCompatibleRelay, parseRelayVersion, RELAY_PROTOCOL_VERSION } from "../../src/relay/index";

describe("relay protocol version", () => {
  it("is 1.1", () => {
    expect(RELAY_PROTOCOL_VERSION).toBe("1.1");
  });

  it("parses major.minor and refuses anything else", () => {
    expect(parseRelayVersion("1.0")).toEqual({ major: 1, minor: 0 });
    expect(parseRelayVersion("2.13")).toEqual({ major: 2, minor: 13 });
    for (const bad of ["", "1", "1.0.0", "01.0", "1.01", "0.1", "256.0", "1.256", "a.b", " 1.0", "1.-1", "1e0.0"]) {
      expect(parseRelayVersion(bad)).toBeUndefined();
    }
  });

  it("is compatible within one major, in either minor order", () => {
    expect(isCompatibleRelay("1.0", "1.0")).toBe(true);
    expect(isCompatibleRelay("1.3", "1.0")).toBe(true);
    expect(isCompatibleRelay("1.0", "1.3")).toBe(true);
    expect(isCompatibleRelay("2.0", "1.0")).toBe(false);
    expect(isCompatibleRelay("1.0", "2.0")).toBe(false);
    expect(isCompatibleRelay("1.0", "garbage")).toBe(false);
  });
});
