// Declares the share actions a platform adds to the Space pages; only the desktop, which runs live shares, provides them.
import type { SpacesHostPort } from "@labshelf/core";

/** The optional share methods of the Spaces host port, all present; the host shows its own progress, prompts and notices. */
export type SpaceSharingHost = Required<Pick<SpacesHostPort, "shareSpace" | "leaveSpace" | "spaceShareState" | "onSpaceShareChange" | "downloadSpacePapers">>;
