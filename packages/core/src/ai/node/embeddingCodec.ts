/**
 * Encodes and decodes Float32Array embeddings to/from the SQLite BLOB column.
 */

/**
 * Serialises a Float32Array into a Buffer suitable for a SQLite BLOB column.
 *
 * @returns Buffer view referencing the same underlying memory.
 */
export function encodeEmbedding(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Deserialises a BLOB column into a Float32Array of `dim` components.
 *
 * @returns Float32Array view over the buffer.
 */
export function decodeEmbedding(blob: Uint8Array, dim: number): Float32Array {
  const expected = dim * 4;
  if (blob.byteLength !== expected) {
    throw new Error(
      `decodeEmbedding: blob is ${blob.byteLength} bytes but dim=${dim} expects ${expected}`,
    );
  }
  return new Float32Array(blob.buffer, blob.byteOffset, dim);
}
