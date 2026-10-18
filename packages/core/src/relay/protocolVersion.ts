// Parses relay protocol versions and decides whether a client and a Worker can talk.

// CONTRACT: documents/contracts/relay.md#versions
export const RELAY_PROTOCOL_MAJOR = 2;
export const RELAY_PROTOCOL_MINOR = 0;
export const RELAY_PROTOCOL_VERSION = `${RELAY_PROTOCOL_MAJOR}.${RELAY_PROTOCOL_MINOR}`;
/** The Worker build `/version` reports; the patch counts Worker changes that keep the protocol. */
export const RELAY_WORKER_BUILD = `${RELAY_PROTOCOL_VERSION}.0`;

export interface RelayVersion { major: number; minor: number }

// INVARIANT: both parts fit one byte, because socket messages carry them as two bytes.
const VERSION_PATTERN = /^([1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

/** Undefined for anything but `major.minor` with major 1 to 255 and minor 0 to 255. */
export function parseRelayVersion(text: string): RelayVersion | undefined {
  const match = VERSION_PATTERN.exec(text);
  if (!match) { return undefined; }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major <= 255 && minor <= 255 ? { major, minor } : undefined;
}

/** True when both versions are valid and share a major; minors may differ either way. */
export function isCompatibleRelay(clientVersion: string, workerVersion: string): boolean {
  const client = parseRelayVersion(clientVersion);
  const worker = parseRelayVersion(workerVersion);
  return client !== undefined && worker !== undefined && client.major === worker.major;
}
