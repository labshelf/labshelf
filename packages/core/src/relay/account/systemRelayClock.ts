// Gives the relay flows the wall clock and real waits.
import type { RelayClock } from "../client/index.js";

export const systemRelayClock: RelayClock = { now: () => Date.now(), sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
