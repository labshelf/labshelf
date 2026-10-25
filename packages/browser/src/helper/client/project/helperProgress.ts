// Extracts the user-facing progress from a progress frame.
import type { HelperProgress, ToPageMessage } from "@labshelf/core/helper";

export function deriveProgress(message: Extract<ToPageMessage, { type: "progress" }>): HelperProgress {
  return message.fraction === undefined
    ? { phase: message.phase, message: message.message }
    : { phase: message.phase, message: message.message, fraction: message.fraction };
}
