// What the account tests share: the relay URL, the remote library's details, and a port and a state of the Account tab.
import type { AccountPort, AccountRemoteDetails, AccountState } from "../../src/account/account.js";

export const RELAY = "https://labshelf-relay.ada.workers.dev";

export const DETAILS: AccountRemoteDetails = { store: "do", used: 1_200_000_000, limit: 5_000_000_000, includePdfs: false, r2Bound: false, warn: false, full: false, leftOut: [] };

type Remote = AccountState["remoteAccess"];

export function viewPort(
  initial: AccountState, estimate: () => Promise<{ bytes: number; files: number }> = async () => ({ bytes: 300_000_000, files: 12 }),
): AccountPort & { remoteCalls: boolean[]; acted: unknown[]; push(state: AccountState): void } {
  const remoteCalls: boolean[] = [];
  const acted: unknown[] = [];
  let listener: ((state: AccountState) => void) | undefined;
  return {
    remoteCalls,
    acted,
    push: (state) => listener?.(state),
    watch: (next) => { listener = next; next(initial); return () => { listener = undefined; }; },
    saveUserName: async () => undefined,
    connectCloudflare: async () => undefined,
    disconnectCloudflare: async () => undefined,
    setRemoteAccess: async (on) => { remoteCalls.push(on); },
    estimatePaperPdfs: estimate,
    setIncludePdfs: async (on) => { acted.push({ includePdfs: on }); },
    setStorageLimit: async (bytes) => { acted.push({ limit: bytes }); },
    moveStore: async (store) => { acted.push({ move: store }); },
  };
}

export const stateOf = (remoteAccess: Remote, relayUrl: string | null = RELAY, cloudflareAvailable = true): AccountState =>
  ({ userName: "Ada", cloudflareAvailable, relayUrl: relayUrl ?? undefined, remoteAccess });
