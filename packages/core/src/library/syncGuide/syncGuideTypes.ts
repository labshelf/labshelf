/** Describes the shape of the "How to sync between computers" guide that every app renders. */

export type SyncGuidePlatform = "macOS" | "Windows" | "Linux";

export interface SyncGuideTool {
  id: string;
  name: string;
  /** One line saying what the tool is for. */
  pitch: string;
  steps: readonly [string, string, string];
  /** The vendor's official download or help page. */
  url: string;
  platforms: readonly SyncGuidePlatform[];
}

export interface SyncGuide {
  title: string;
  intro: string;
  tools: readonly SyncGuideTool[];
  /** The option for people who want no cloud service. */
  noCloud: { title: string; tool: SyncGuideTool };
  afterSetup: { title: string; steps: readonly string[]; conflictNote: string };
}
