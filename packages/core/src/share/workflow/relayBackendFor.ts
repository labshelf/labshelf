// Gives the owner writes of the connected relay account, refusing a share that lives on another relay.
import type { RelayAccount } from "../../relay/index.js";
import { createWorkerShareBackend } from "../http/index.js";
import type { ShareBackend } from "../shareBackend.js";

/** A share made with another account cannot be written or revoked from here, so asking for its relay throws, naming it. */
export function relayBackendFor(account: RelayAccount | undefined): (relayUrl: string) => ShareBackend {
  return (relayUrl) => {
    if (account?.relayUrl !== relayUrl) { throw new Error(`the link lives on ${new URL(relayUrl).host}, a relay this device is not connected to`); }
    return createWorkerShareBackend({ relayUrl, ownerSecret: account.ownerSecret });
  };
}
