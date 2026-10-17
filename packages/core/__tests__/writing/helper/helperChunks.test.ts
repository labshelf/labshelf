/** Verifies that bytes split into protocol chunks reassemble byte-identical and that the assembler rejects malformed sequences. */
import { CHUNK_MAX_BYTES, ChunkAssembler, chunkBytes } from "../../../src/writing/helper/index";

function sample(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let seed = 7;
  for (let i = 0; i < size; i += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; bytes[i] = seed & 0xff; }
  return bytes;
}

describe("chunkBytes", () => {
  it("splits 3 MB into chunks of at most 512 KiB that reassemble byte-identical", () => {
    const bytes = sample(3 * 1024 * 1024);
    const chunks = chunkBytes(bytes);
    expect(chunks).toHaveLength(Math.ceil(bytes.length / CHUNK_MAX_BYTES));
    expect(chunks.every((chunk) => chunk.count === chunks.length)).toBe(true);
    expect(chunks.every((chunk) => atob(chunk.data).length <= CHUNK_MAX_BYTES)).toBe(true);
    const assembler = new ChunkAssembler();
    const results = chunks.map((chunk) => assembler.add(chunk));
    expect(results.slice(0, -1).every((result) => result.status === "partial")).toBe(true);
    const last = results[results.length - 1]!;
    expect(last.status).toBe("complete");
    expect(last.status === "complete" && Buffer.from(last.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it("sends an empty buffer as one empty chunk", () => {
    const chunks = chunkBytes(new Uint8Array(0));
    expect(chunks).toEqual([{ index: 0, count: 1, data: "" }]);
    const result = new ChunkAssembler().add(chunks[0]!);
    expect(result.status === "complete" && result.bytes.length).toBe(0);
  });
});

describe("ChunkAssembler", () => {
  const chunks = chunkBytes(sample(CHUNK_MAX_BYTES * 3));

  it("rejects a gap", () => {
    const assembler = new ChunkAssembler();
    assembler.add(chunks[0]!);
    expect(assembler.add(chunks[2]!)).toEqual({ status: "rejected", reason: "gap" });
  });

  it("rejects a first chunk that is not index 0", () => {
    expect(new ChunkAssembler().add(chunks[1]!)).toEqual({ status: "rejected", reason: "gap" });
  });

  it("rejects a duplicate", () => {
    const assembler = new ChunkAssembler();
    assembler.add(chunks[0]!);
    assembler.add(chunks[1]!);
    expect(assembler.add(chunks[1]!)).toEqual({ status: "rejected", reason: "duplicate" });
  });

  it("rejects a chunk after the sequence is complete", () => {
    const assembler = new ChunkAssembler();
    chunks.forEach((chunk) => assembler.add(chunk));
    expect(assembler.add(chunks[2]!)).toEqual({ status: "rejected", reason: "duplicate" });
  });

  it("rejects a count change", () => {
    const assembler = new ChunkAssembler();
    assembler.add(chunks[0]!);
    expect(assembler.add({ ...chunks[1]!, count: 4 })).toEqual({ status: "rejected", reason: "count-changed" });
  });

  it("rejects an oversized or undecodable chunk", () => {
    const big = btoa("x".repeat(CHUNK_MAX_BYTES + 1));
    expect(new ChunkAssembler().add({ index: 0, count: 1, data: big })).toEqual({ status: "rejected", reason: "invalid-chunk" });
    expect(new ChunkAssembler().add({ index: 0, count: 1, data: "@@@" })).toEqual({ status: "rejected", reason: "invalid-chunk" });
  });
});
