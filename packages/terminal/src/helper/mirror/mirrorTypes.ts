// Declares the rejection a mirror operation fails with and the state handlers share.
import type { ILogger } from "@labshelf/core";
import type { ChunkAssembler, HelperRejectionCode } from "@labshelf/core/helper";

/** A protocol rejection: the `code` goes to the page in an `error` frame and the context goes to the log. */
export class MirrorRejection extends Error {
  constructor(
    readonly code: HelperRejectionCode,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** A file the last `sync` asked for, with the chunks received so far. */
export interface PendingFile { sha256: string; size: number; assembler?: ChunkAssembler | undefined }

export interface MirrorContext {
  projectsRoot: string;
  logger: ILogger;
  /** Per project, the files still needed since its last `sync`, keyed by path. */
  pending: Map<string, Map<string, PendingFile>>;
}

export const MIRROR_MODULE = "helper/mirror";
