/** Tells whether bytes are a PDF: the "%PDF-" header must be the first five bytes, as the importer and the parser require. */

const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function isPdfBytes(bytes: Uint8Array): boolean {
  return HEADER.every((byte, index) => bytes[index] === byte);
}
