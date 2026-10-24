/** Pins that owner writes go only to the connected relay, and a share on another relay is refused by name. */
import type { RelayAccount } from "../../../src/relay/index";
import { relayBackendFor } from "../../../src/share/index";

const account = { relayUrl: "https://relay.me.workers.dev", ownerSecret: "secret" } as RelayAccount;

describe("relayBackendFor", () => {
  it("gives the owner backend of the connected relay", () => {
    expect(typeof relayBackendFor(account)(account.relayUrl).putManifest).toBe("function");
  });

  it("refuses a relay this device is not connected to, naming its host", () => {
    expect(() => relayBackendFor(account)("https://relay.other.workers.dev")).toThrow(/relay\.other\.workers\.dev.*not connected/);
    expect(() => relayBackendFor(undefined)(account.relayUrl)).toThrow(/relay\.me\.workers\.dev/);
  });
});
