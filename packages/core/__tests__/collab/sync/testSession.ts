/** Opens share sessions on a fake network for the tests of channels layered on a session. */
import { deriveAwarenessKey, deriveContentKey } from "../../../src/collab/crypto/index";
import { createShareSession, type ShareSession } from "../../../src/collab/sync/index";
import type { ILogger } from "../../../src/ports/index";
import type { FakeClock, FakeNetwork } from "./fakeNetwork";

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
    shareId: SHARE_ID, contentKey: await deriveContentKey(SHARE_KEY), transport: net.join(id), logger, scheduler: clock,
  });
  return { id, session, logger };
}

export const awarenessKey = () => deriveAwarenessKey(SHARE_KEY);
export const contentKey = () => deriveContentKey(SHARE_KEY);
