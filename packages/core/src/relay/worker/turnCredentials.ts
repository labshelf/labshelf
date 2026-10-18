// Mints short-lived TURN credentials for a share from the owner's Cloudflare Realtime TURN key.

import type { IceServer } from "../http/index.js";
import type { RelayEnv } from "./cloudflareRuntime.js";

const TURN_TTL_SECONDS = 3600;

export type TurnResult =
  | { ok: true; iceServers: IceServer[]; expires: number }
  | { ok: false; error: "turnUnavailable" };

export async function mintIceServers(env: RelayEnv, nowSeconds: number): Promise<TurnResult> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_SECRET) {
    console.warn("relay turn: no TURN key is configured, refusing /turn");
    return { ok: false, error: "turnUnavailable" };
  }
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });
    const body = response.ok ? ((await response.json()) as { iceServers?: unknown }) : undefined;
    if (!body || !Array.isArray(body.iceServers)) {
      console.error(`relay turn: Cloudflare answered ${response.status} without iceServers`);
      return { ok: false, error: "turnUnavailable" };
    }
    return { ok: true, iceServers: body.iceServers as IceServer[], expires: nowSeconds + TURN_TTL_SECONDS };
  } catch (error) {
    console.error(`relay turn: minting credentials failed: ${String(error)}`);
    return { ok: false, error: "turnUnavailable" };
  }
}
