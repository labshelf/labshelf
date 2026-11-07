// Declares the share actions a platform adds to the Space pages; only the desktop, which runs live shares, provides them.
import type { SpacesHostPort } from "@labshelf/core";

/** The optional share and presence methods of the Spaces host port, all present; the host shows its own progress, prompts and notices. */
type SpaceSharingPort = Required<Pick<SpacesHostPort,
  "shareSpace" | "leaveSpace" | "spaceShareState" | "onSpaceShareChange" | "downloadSpacePapers" | "setSpacePresence" | "spacePeers" | "onSpacePeersChange">>;

/** The share actions and the member's display name, stamped as the author of what the Space pages add. */
export type SpaceSharingHost = SpaceSharingPort & { author: () => string };
