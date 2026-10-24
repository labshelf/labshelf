// Decodes ASCII-armored OpenPGP blocks into their packets, rejecting truncated or streamed packets.

export interface OpenPgpPacket {
  tag: number;
  body: Buffer;
}

/** The binary content of the first `-----BEGIN <label>-----` block; the CRC line is ignored. */
export function dearmor(armored: string, label: string): Buffer {
  const lines = armored.split(/\r?\n/).map((line) => line.trim());
  const begin = lines.indexOf(`-----BEGIN ${label}-----`);
  const end = lines.indexOf(`-----END ${label}-----`, begin + 1);
  if (begin < 0 || end < 0) { throw new Error(`Expected an armored ${label} block`); }
  const blank = lines.indexOf("", begin + 1);
  if (blank < 0 || blank > end) { throw new Error(`The armored ${label} block has no blank line after its headers`); }
  const body = lines.slice(blank + 1, end).filter((line) => !line.startsWith("=")).join("");
  return Buffer.from(body, "base64");
}

function readLength(bytes: Buffer, offset: number, newFormat: boolean, lengthType: number): { length: number; start: number } {
  if (newFormat) {
    const first = bytes[offset] ?? 0;
    if (first < 192) { return { length: first, start: offset + 1 }; }
    if (first < 224) { return { length: ((first - 192) << 8) + (bytes[offset + 1] ?? 0) + 192, start: offset + 2 }; }
    if (first === 255 && offset + 5 <= bytes.length) { return { length: bytes.readUInt32BE(offset + 1), start: offset + 5 }; }
    throw new Error("OpenPGP partial body lengths are not supported");
  }
  if (lengthType === 0) { return { length: bytes[offset] ?? 0, start: offset + 1 }; }
  if (lengthType === 1 && offset + 2 <= bytes.length) { return { length: bytes.readUInt16BE(offset), start: offset + 2 }; }
  if (lengthType === 2 && offset + 4 <= bytes.length) { return { length: bytes.readUInt32BE(offset), start: offset + 4 }; }
  throw new Error("OpenPGP indeterminate packet lengths are not supported");
}

export function readPackets(bytes: Buffer): OpenPgpPacket[] {
  const packets: OpenPgpPacket[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const header = bytes[offset] ?? 0;
    if ((header & 0x80) === 0) { throw new Error(`Invalid OpenPGP packet header at byte ${offset}`); }
    const newFormat = (header & 0x40) !== 0;
    const tag = newFormat ? header & 0x3f : (header >> 2) & 0x0f;
    const { length, start } = readLength(bytes, offset + 1, newFormat, header & 0x03);
    if (start + length > bytes.length) { throw new Error(`Truncated OpenPGP packet (tag ${tag}) at byte ${offset}`); }
    packets.push({ tag, body: bytes.subarray(start, start + length) });
    offset = start + length;
  }
  return packets;
}

/** Reads a multiprecision integer at `offset`; returns its magnitude bytes and the offset after it. */
export function readMpi(body: Buffer, offset: number): { value: Buffer; next: number } {
  if (offset + 2 > body.length) { throw new Error("Truncated OpenPGP MPI"); }
  const next = offset + 2 + Math.ceil(body.readUInt16BE(offset) / 8);
  if (next > body.length) { throw new Error("Truncated OpenPGP MPI"); }
  return { value: body.subarray(offset + 2, next), next };
}
