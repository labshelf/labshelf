/** Holds one session's uncommitted writes as decoded bytes, within the open-write and staged-byte caps. */
import { base64ToBytes } from "../../encoding/index.js";
import { BridgeError } from "../bridgeError.js";

// CONTRACT: documents/contracts/bridge.md#file-transfer
const MAX_OPEN_WRITES = 8;
const MAX_STAGED_BYTES = 256 * 1024 * 1024;

interface StagedWrite {
  path: string;
  parts: Uint8Array[];
  size: number;
}

interface CommittableWrite {
  path: string;
  bytes: Uint8Array;
}

const refuse = (message: string): never => { throw new BridgeError("protocol", message); };

export class StagedWrites {
  private readonly writes = new Map<number, StagedWrite>();
  private stagedBytes = 0;

  open(id: number, path: string): void {
    if (this.writes.has(id)) refuse(`A writeFile with id ${id} is already open`);
    if (this.writes.size >= MAX_OPEN_WRITES) refuse(`At most ${MAX_OPEN_WRITES} writes may be open at once`);
    this.writes.set(id, { path, parts: [], size: 0 });
  }

  append(id: number, data: string): void {
    const write = this.get(id);
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(data);
    } catch {
      return refuse(`Chunk data for id ${id} is not canonical base64`);
    }
    if (this.stagedBytes + bytes.length > MAX_STAGED_BYTES) refuse(`Staged writes exceed ${MAX_STAGED_BYTES} bytes`);
    write.parts.push(bytes);
    write.size += bytes.length;
    this.stagedBytes += bytes.length;
  }

  /** Removes the write and returns its bytes when they add up to `size`; on a mismatch the write is dropped. */
  take(id: number, size: number): CommittableWrite {
    const write = this.get(id);
    this.drop(id);
    if (write.size !== size) refuse(`Commit for id ${id} declares ${size} bytes, ${write.size} were staged`);
    const bytes = new Uint8Array(write.size);
    let offset = 0;
    for (const part of write.parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return { path: write.path, bytes };
  }

  drop(id: number): void {
    const write = this.writes.get(id);
    if (!write) return;
    this.stagedBytes -= write.size;
    this.writes.delete(id);
  }

  private get(id: number): StagedWrite {
    return this.writes.get(id) ?? refuse(`No open writeFile for id ${id}`);
  }
}
