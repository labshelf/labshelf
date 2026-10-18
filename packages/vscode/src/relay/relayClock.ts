// Gives the relay flows the wall clock and real waits.
import type { RelayClock } from "@labshelf/core";

export const relayClock: RelayClock = { now: () => Date.now(), sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
