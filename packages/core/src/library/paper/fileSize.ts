/** Formats a byte count as text: "812 B", "812 KB", "2.4 MB". */

/** @returns the size text, rounded for display */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) { return `${kb} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
