/** Pins that a relay-stored message carries epoch and seq 0 and opens back to its update. */
import { decodeEnvelope, MESSAGE_KIND } from "../../../src/collab/peer/envelope";
import { docIdCache } from "../../../src/collab/peer/docMessage";
import { openStored, sealStored } from "../../../src/collab/relays/storedFrames";
import { contentKey, SHARE_ID } from "../doc/testSession";

describe("stored frames", () => {
  it("seals an update with epoch and seq 0 and opens it for its doc only", async () => {
    const context = { shareId: SHARE_ID, key: await contentKey(), docIdOf: docIdCache(SHARE_ID) };
    const payload = new Uint8Array([1, 2, 3]);
    const { message } = await sealStored(context, MESSAGE_KIND.update, "main.typ", payload);
    const decoded = decodeEnvelope(message);
    expect(decoded.ok && { epoch: decoded.envelope.epoch, seq: decoded.envelope.seq }).toEqual({ epoch: 0n, seq: 0 });
    expect(await openStored(context, "main.typ", message)).toEqual(payload);
    expect(await openStored(context, "other.typ", message)).toBeUndefined();
  });
});
