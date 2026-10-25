/** Describes a writing project folder as the host lists it: ready with its settings, or broken with a reason. */
import type { ProjectSettings } from "./projectFile.js";

/** "library": under <library>/projects/; "external": a registered folder anywhere else. */
export type ProjectPlacement = "library" | "external";

export type ProjectEntry =
  | {
    kind: "ready";
    folder: string;
    location: ProjectPlacement;
    settings: ProjectSettings;
    /** The main file from labshelf.yaml, else the detected one; undefined when neither exists. */
    main: string | undefined;
  }
  | { kind: "broken"; folder: string; location: ProjectPlacement; reason: string };
