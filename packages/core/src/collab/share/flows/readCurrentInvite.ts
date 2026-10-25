// Stores and formats the invite link of a connected share from its key and the relays its index lists now.
import { formatInvite } from "../../invite/index.js";
import { readRelayList } from "../../relays/index.js";
import type { ShareConnection } from "../../session/index.js";
import type { ShareFlowPorts } from "./sharePorts.js";

/**
 * The link to hand out. A stored link goes stale as members offer and withdraw relays, so it is never handed out as stored.
 * CONTRACT: documents/contracts/collaboration.md#relay-list — the invite's relays stand in while the index lists none.
 */
export async function readCurrentInvite(ports: Pick<ShareFlowPorts, "keys">, share: ShareConnection): Promise<string> {
  const { shareId, shareKey } = share;
  const listed = readRelayList(share.session.index).map(({ url }) => ({ url }));
  const relays = listed.length > 0 ? listed : (await ports.keys.invite(shareId))?.relays ?? [];
  await ports.keys.remember({ shareId, shareKey, relays });
  return formatInvite({ shareKey, relays });
}
