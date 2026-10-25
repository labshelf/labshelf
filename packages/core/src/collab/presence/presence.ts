// Defines the presence a collaborator shares (name, colour, file, selection and relay) and checks one received from a peer.

/** The relay a peer uses and the relays it holds down, by URL, until an epoch time in milliseconds. */
export interface RelayReport {
  relay: string | null;
  relaysDown: Record<string, number>;
}

/** `anchor` and `head` are base64 Yjs relative positions, opaque here; null when nothing is selected. */
export interface PresenceState extends Partial<RelayReport> {
  name: string;
  colour: string;
  file: string | null;
  anchor: string | null;
  head: string | null;
}

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

const isDownMap = (value: unknown): value is Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
  && Object.values(value).every((until) => typeof until === "number" && Number.isFinite(until));

/** A peer's state is untrusted input: anything that is not exactly this shape is not shown. */
export function isPeerPresence(value: unknown): value is PresenceState {
  if (typeof value !== "object" || value === null) { return false; }
  const state = value as Record<string, unknown>;
  return typeof state.name === "string" && typeof state.colour === "string"
    && isTextOrNull(state.file) && isTextOrNull(state.anchor) && isTextOrNull(state.head)
    && (state.relay === undefined || isTextOrNull(state.relay))
    && (state.relaysDown === undefined || isDownMap(state.relaysDown));
}
