// Defines the presence a collaborator shares (name, colour, file and selection) and checks one received from a peer.

/** `anchor` and `head` are base64 Yjs relative positions, opaque here; null when nothing is selected. */
export interface PresenceState {
  name: string;
  colour: string;
  file: string | null;
  anchor: string | null;
  head: string | null;
}

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/** A peer's state is untrusted input: anything that is not exactly this shape is not shown. */
export function isPresenceState(value: unknown): value is PresenceState {
  if (typeof value !== "object" || value === null) { return false; }
  const state = value as Record<string, unknown>;
  return typeof state.name === "string" && typeof state.colour === "string"
    && isTextOrNull(state.file) && isTextOrNull(state.anchor) && isTextOrNull(state.head);
}
