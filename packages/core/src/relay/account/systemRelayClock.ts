// Gives the relay flows the wall clock and real waits.
import { sleep } from "../../async/index.js";
import type { RelayClock } from "../client/index.js";

export const systemRelayClock: RelayClock = { now: () => Date.now(), sleep: (ms) => sleep(ms) };
