/** Describes a writing project folder as the host lists it: ready with its settings, or broken with a reason. */
import type { ProjectSettings } from "./projectFile.js";

/** "library": under <library>/projects/; "external": a registered folder anywhere else. */
export type ProjectLocation = "library" | "external";

export type ProjectEntry =
  | {
    kind: "ready";
    folder: string;
    location: ProjectLocation;
    settings: ProjectSettings;
    /** The main file from labshelf.yaml, else the detected one; undefined when neither exists. */
    main: string | undefined;
  }
  | { kind: "broken"; folder: string; location: ProjectLocation; reason: string };
