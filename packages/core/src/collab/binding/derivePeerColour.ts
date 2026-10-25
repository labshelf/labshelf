// Picks the colour a collaborator's cursor and selection are drawn in, from the highlight palette.
import { HIGHLIGHT_COLORS } from "../../ui/tokens/index.js";

const PEER_COLOURS: readonly string[] = Object.values(HIGHLIGHT_COLORS);

/**
 * The colour a peer announces is kept only when it is one of the palette's, since presence is
 * untrusted input that ends up in editor CSS; any other peer gets the same colour on every
 * screen from its awareness client id.
 */
export function derivePeerColour(announced: string, clientId: number): string {
  return PEER_COLOURS.includes(announced) ? announced : PEER_COLOURS[Math.abs(clientId) % PEER_COLOURS.length]!;
}
