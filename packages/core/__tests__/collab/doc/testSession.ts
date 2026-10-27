/** Opens share sessions on a fake network for the tests of channels layered on a session. */
import { derivePresenceShareKey, deriveContentShareKey } from "../../../src/collab/invite/index";
import { createShareSession, type ShareSession } from "../../../src/collab/doc/index";
import type { ILogger } from "../../../src/ports/index";
import type { FakeClock, FakeNetwork } from "../peer/fakeNetwork";

export const SHARE_ID = "f".repeat(32);
export const SHARE_KEY = new Uint8Array(16).fill(1);

export const fakeLogger = () => ({
  log: jest.fn(async (..._args: Parameters<ILogger["log"]>) => {}),
  error: jest.fn(async (..._args: Parameters<ILogger["error"]>) => {}),
});
export type FakeLogger = ReturnType<typeof fakeLogger>;

export interface TestClient { id: string; session: ShareSession; logger: FakeLogger }

export async function openSession(net: FakeNetwork, clock: FakeClock, id: string): Promise<TestClient> {
  const logger = fakeLogger();
  const session = createShareSession({
    shareId: SHARE_ID, contentKey: await deriveContentShareKey(SHARE_KEY), transport: net.join(id), logger, scheduler: clock,
  });
  return { id, session, logger };
}

export const awarenessKey = () => derivePresenceShareKey(SHARE_KEY);
export const contentKey = () => deriveContentShareKey(SHARE_KEY);
