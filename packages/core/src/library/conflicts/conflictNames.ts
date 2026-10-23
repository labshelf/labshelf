// Recognises the file names sync tools give conflict copies and recovers the original name.
// TRAP: unconfirmed provider suffixes resemble ordinary user file names.
import type { SyncTool } from "./conflictCopy.js";

export interface ParsedConflictName {
  original: string;
  tool: SyncTool;
}

/** Each pattern captures the base name and, when the tool puts its marker before the extension, the extension. */
const PATTERNS: ReadonlyArray<{ tool: SyncTool; pattern: RegExp }> = [
  { tool: "app", pattern: /^(.+)\.labshelf-conflict-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}()$/ },
  // name.sync-conflict-<yyyyMMdd>-<HHmmss>-<short device id>.ext
  { tool: "syncthing", pattern: /^(.+?)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(\.[^.]+)?$/ },
  // name (conflicted copy [user ]yyyy-MM-dd hhmmss).ext
  { tool: "nextcloud", pattern: /^(.+?) \(conflicted copy (?:\S.* )?\d{4}-\d{2}-\d{2} \d{6}\)(\.[^.]+)?$/ },
  // name (User's conflicted copy yyyy-MM-dd[ (n)]).ext
  { tool: "dropbox", pattern: /^(.+?) \(.+'s conflicted copy \d{4}-\d{2}-\d{2}(?: \(\d+\))?\)(\.[^.]+)?$/ },
  // name.ext.conflictN, name.conflictN.ext (--suffix-keep-extension), name.ext.pathN or name.ext..pathN (--conflict-loser pathname)
  { tool: "rclone", pattern: /^(.+)\.conflict\d+()$/ },
  { tool: "rclone", pattern: /^(.+?)\.conflict\d+(\.[^.]+)$/ },
  { tool: "rclone", pattern: /^(.+?)\.\.?path[12]()$/ },
];

/** @returns the original name and the tool, or null when the name is not a conflict copy. */
export function parseConflictName(name: string): ParsedConflictName | null {
  for (const { tool, pattern } of PATTERNS) {
    const match = pattern.exec(name);
    if (match) { return { original: `${match[1]}${match[2] ?? ""}`, tool }; }
  }
  return null;
}
