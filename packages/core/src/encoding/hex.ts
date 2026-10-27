// Converts bytes to and from hexadecimal text, written lower case and read in either case.

const HEX = /^(?:[0-9a-fA-F]{2})*$/;

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Throws when `hex` has an odd length or a character outside 0-9, a-f and A-F. */
export function hexToBytes(hex: string): Uint8Array {
  if (!HEX.test(hex)) { throw new Error(`Not hexadecimal (${hex.length} characters)`); }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) { bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); }
  return bytes;
}
