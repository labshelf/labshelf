// Admits connected peers into the sync mesh up to its size limit and queues the rest in arrival order.
import type { PeerId } from "../../transport/index.js";

/** Every peer holds a direct link to every other, so links grow with the square of the mesh. */
export const MAX_MESH_PEERS = 8;

export class MeshAdmission {
  readonly admitted: PeerId[] = [];
  private waiting: PeerId[] = [];

  get full(): boolean { return this.waiting.length > 0; }

  /** True when the peer is admitted. */
  join(peer: PeerId): boolean {
    if (this.admitted.includes(peer) || this.waiting.includes(peer)) { return this.admitted.includes(peer); }
    if (this.admitted.length < MAX_MESH_PEERS) {
      this.admitted.push(peer);
      return true;
    }
    this.waiting.push(peer);
    return false;
  }

  /** The waiting peer admitted into the freed slot, if any. */
  leave(peer: PeerId): PeerId | undefined {
    this.waiting = this.waiting.filter((other) => other !== peer);
    const at = this.admitted.indexOf(peer);
    if (at < 0) { return undefined; }
    this.admitted.splice(at, 1);
    const next = this.waiting.shift();
    if (next !== undefined) { this.admitted.push(next); }
    return next;
  }
}
