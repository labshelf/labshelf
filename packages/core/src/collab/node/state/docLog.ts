// Encodes and decodes the records of a doc's append-only update log.
// CONTRACT: documents/contracts/collaboration.md#device-local-state

const LENGTH_BYTES = 4;

/** One record: the update's length as 4 bytes big-endian, then the update. */
export function logRecord(update: Uint8Array): Uint8Array {
  const record = new Uint8Array(LENGTH_BYTES + update.length);
  new DataView(record.buffer).setUint32(0, update.length);
  record.set(update, LENGTH_BYTES);
  return record;
}

/** The complete records of a log; a torn final record from an interrupted append is reported as `torn`. */
export function readRecords(log: Uint8Array): { updates: Uint8Array[]; torn: boolean } {
  const updates: Uint8Array[] = [];
  const view = new DataView(log.buffer, log.byteOffset, log.byteLength);
  let offset = 0;
  while (offset + LENGTH_BYTES <= log.length) {
    const length = view.getUint32(offset);
    if (offset + LENGTH_BYTES + length > log.length) { break; }
    updates.push(log.subarray(offset + LENGTH_BYTES, offset + LENGTH_BYTES + length));
    offset += LENGTH_BYTES + length;
  }
  return { updates, torn: offset < log.length };
}
