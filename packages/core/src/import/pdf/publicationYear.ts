/** Finds the publication year stated in the front matter of a paper. */

/**
 * Finds the publication year in the front matter of a paper (copyright line,
 * "Published/Received/Accepted" dates), which beats the PDF's file timestamp.
 * @returns A four-digit year, or undefined when none is stated.
 */
export function extractYearFromText(text: string): number | undefined {
  const patterns = [
    /(?:©|\(c\)|copyright)\s*(?:the author[s]?[,\s]*)?((?:19|20)\d{2})/i,
    /\b(?:published|accepted|received|issued|revised)\b[^\n]{0,40}?\b((?:19|20)\d{2})\b/i,
    /\b(?:19|20)\d{2}\b(?=[^\n]{0,20}\b(?:vol|volume|issue|no\.)\b)/i,
  ];

  const currentYear = new Date().getFullYear();
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const year = Number(match?.[1] ?? match?.[0]);
    if (year >= 1900 && year <= currentYear + 1) {
      return year;
    }
  }
  return undefined;
}
