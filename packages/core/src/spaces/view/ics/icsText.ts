// Escapes and folds iCalendar text values and content lines (RFC 5545 sections 3.1 and 3.3.11).

export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const utf8Length = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Folds a line into physical lines of at most 75 octets, each continuation starting with one space; never splits a character. */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = utf8Length(ch.codePointAt(0)!);
    // A continuation line spends one octet on its leading space.
    if (octets + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
