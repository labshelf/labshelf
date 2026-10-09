/** The one test that proves bytes are a PDF: "%PDF-" within the first KiB, because some servers prepend junk. */

export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}
