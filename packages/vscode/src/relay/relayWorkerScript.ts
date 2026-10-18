// Hands out the relay Worker script that the desktop build embeds.

// INVARIANT: build/host.mjs defines this for the desktop bundle only; nothing the web bundle loads reaches this module.
declare const RELAY_WORKER_SCRIPT: string;

export const relayWorkerScript = (): string => RELAY_WORKER_SCRIPT;
